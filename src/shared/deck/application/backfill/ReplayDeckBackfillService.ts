import { ReplayG1DeckExtractor } from "../../domain/backfill/ReplayG1DeckExtractor";
import { classifyDeck } from "../../domain/classifier/DeckClassifier";
import { CardAliasProvider } from "../../../stats/persistence/RankedMatchPersistenceService";
import { CdbCardAliasProvider } from "../../infrastructure/cdb/CdbCardAliasProvider";

export interface PostgresConnectionConfig {
	host: string;
	port: number;
	database: string;
	user: string;
	password?: string;
}

export function validateDatabaseConfigs(
	readConfig: PostgresConnectionConfig,
	writeConfig: PostgresConnectionConfig,
): { valid: boolean; error?: string } {
	if (
		!readConfig.host ||
		!readConfig.port ||
		!readConfig.database ||
		!readConfig.user ||
		!writeConfig.host ||
		!writeConfig.port ||
		!writeConfig.database ||
		!writeConfig.user
	) {
		return {
			valid: false,
			error: "Missing database connection parameters",
		};
	}

	const normalizeHost = (h: string) => (h === "localhost" ? "127.0.0.1" : h);
	const readHost = normalizeHost(readConfig.host);
	const writeHost = normalizeHost(writeConfig.host);

	if (
		readHost !== writeHost ||
		Number(readConfig.port) !== Number(writeConfig.port) ||
		readConfig.database !== writeConfig.database
	) {
		return {
			valid: false,
			error: "READONLY and WRITE connections must point to the same database target",
		};
	}

	if (readConfig.user === writeConfig.user) {
		return {
			valid: false,
			error: "READONLY connection must use a distinct readonly user, not the write user",
		};
	}

	return { valid: true };
}

export function sanitizeDatabaseError(err: unknown): string {
	if (!err) return "UnknownDatabaseError";
	const e = err as { code?: string | number; name?: string; message?: string };
	const code = String(e.code ?? "");
	const msg = String(e.message ?? "").toLowerCase();

	if (code === "ECONNREFUSED" || msg.includes("econnrefused")) {
		return "ConnectionRefusedError";
	}
	if (code === "ENOTFOUND" || msg.includes("enotfound")) {
		return "HostNotFoundError";
	}
	if (code === "ETIMEDOUT" || msg.includes("timeout") || msg.includes("etimedout")) {
		return "ConnectionTimeoutError";
	}
	if (code === "28P01" || msg.includes("password authentication failed")) {
		return "AuthenticationFailedError";
	}
	if (code === "42501" || msg.includes("permission denied") || msg.includes("must be member")) {
		return "InsufficientPrivilegeError";
	}
	if (code === "3D000" || (msg.includes("database") && msg.includes("does not exist"))) {
		return "DatabaseNotFoundError";
	}
	if (code === "42P01" || (msg.includes("relation") && msg.includes("does not exist"))) {
		return "TableNotFoundError";
	}
	if (code === "ECONNRESET" || msg.includes("econnreset") || msg.includes("connection reset")) {
		return "ConnectionResetError";
	}

	return e.name || "DatabaseError";
}

export function extractRows<T>(result: any): T[] {
	if (!result) return [];
	if (Array.isArray(result)) return result;
	if (Array.isArray(result.rows)) return result.rows;
	return [];
}

export async function verifyConnectionPermissions(
	readonlyClient: Queryable,
	writeClient: Queryable,
	execute: boolean,
): Promise<{ valid: boolean; error?: string }> {
	try {
		const readRes = await readonlyClient.query(
			"SELECT has_table_privilege(current_user, 'matches', 'SELECT') AS can_select",
		);
		const canSelect = extractRows<{ can_select?: boolean }>(readRes)[0]?.can_select;
		if (canSelect === false) {
			return {
				valid: false,
				error: "READONLY user does not have SELECT privilege on matches table",
			};
		}
	} catch (err: unknown) {
		return {
			valid: false,
			error: `READONLY connection precheck failed: ${sanitizeDatabaseError(err)}`,
		};
	}

	if (execute) {
		try {
			const writeRes = await writeClient.query(
				"SELECT has_table_privilege(current_user, 'match_decks', 'INSERT') AS can_insert",
			);
			const canInsert = extractRows<{ can_insert?: boolean }>(writeRes)[0]?.can_insert;
			if (canInsert === false) {
				return {
					valid: false,
					error: "WRITE user does not have INSERT privilege on match_decks table",
				};
			}
		} catch (err: unknown) {
			return {
				valid: false,
				error: `WRITE connection permission precheck failed: ${sanitizeDatabaseError(err)}`,
			};
		}
	}

	return { valid: true };
}

export interface BackfillOptions {
	formatId: string;
	dryRun: boolean;
	batchSize?: number;
	limit?: number;
	cursor?: string;
}

export interface BackfillReport {
	formatId: string;
	dryRun: boolean;
	scannedGames: number;
	candidates: number;
	successful: number;
	lastGameId?: string;
	resumeCursor?: string;
	failedGameIds: string[];
	skipped: {
		onlineSnapshotExists: number;
		alreadyBackfilled: number;
		invalidPerspectives: number;
		missingG1Replay: number;
		invalidReplayOrDeck: number;
		ambiguousIdentity: number;
		writeFailed?: number;
	};
}

export interface Queryable {
	query(sql: string, params?: any[]): Promise<any>;
}

export class ReplayDeckBackfillService {
	private readonly extractor = new ReplayG1DeckExtractor();

	constructor(
		private readonly readonlyClient: Queryable,
		private readonly writeClient: Queryable,
		private readonly aliasProvider: CardAliasProvider = new CdbCardAliasProvider(),
	) {}

	private async executeInTransaction(fn: (client: Queryable) => Promise<void>): Promise<void> {
		const pool = this.writeClient as {
			connect?: () => Promise<Queryable & { release: () => void }>;
		};
		if (typeof pool.connect === "function") {
			const client = await pool.connect();
			try {
				await client.query("BEGIN");
				await fn(client);
				await client.query("COMMIT");
			} catch (error) {
				await client.query("ROLLBACK").catch(() => {
					// Ignore rollback errors when transaction fails
				});
				throw error;
			} finally {
				client.release();
			}
		} else {
			await this.writeClient.query("BEGIN");
			try {
				await fn(this.writeClient);
				await this.writeClient.query("COMMIT");
			} catch (error) {
				await this.writeClient.query("ROLLBACK").catch(() => {
					// Ignore rollback errors when transaction fails
				});
				throw error;
			}
		}
	}

	async run(options: BackfillOptions): Promise<BackfillReport> {
		const report: BackfillReport = {
			formatId: options.formatId,
			dryRun: options.dryRun,
			scannedGames: 0,
			candidates: 0,
			successful: 0,
			failedGameIds: [],
			skipped: {
				onlineSnapshotExists: 0,
				alreadyBackfilled: 0,
				invalidPerspectives: 0,
				missingG1Replay: 0,
				invalidReplayOrDeck: 0,
				ambiguousIdentity: 0,
			},
		};

		const aliasMap = await this.aliasProvider.getAliases(options.formatId);
		const batchSize = Math.max(1, options.batchSize ?? 100);
		let cursor: string | undefined = options.cursor;
		let totalScanned = 0;
		let firstFailedGameId: string | undefined = undefined;
		let lastSafeGameId: string | undefined = options.cursor;

		while (true) {
			const remainingLimit = options.limit !== undefined ? options.limit - totalScanned : undefined;
			if (remainingLimit !== undefined && remainingLimit <= 0) {
				break;
			}
			const currentLimit =
				remainingLimit !== undefined ? Math.min(batchSize, remainingLimit) : batchSize;

			const gamesSql = cursor
				? `
					SELECT DISTINCT m.game_id AS "gameId"
					FROM matches m
					WHERE m.format_id = $1
					  AND m.anulled = false
					  AND m.deleted_at IS NULL
					  AND m.game_id > $2
					ORDER BY m.game_id ASC
					LIMIT $3
				`
				: `
					SELECT DISTINCT m.game_id AS "gameId"
					FROM matches m
					WHERE m.format_id = $1
					  AND m.anulled = false
					  AND m.deleted_at IS NULL
					ORDER BY m.game_id ASC
					LIMIT $2
				`;

			const params = cursor
				? [options.formatId, cursor, currentLimit]
				: [options.formatId, currentLimit];

			const rawGameRows = await this.readonlyClient.query(gamesSql, params);
			const gameRows = extractRows<{ gameId: string }>(rawGameRows);

			if (!gameRows || gameRows.length === 0) {
				break;
			}

			report.scannedGames += gameRows.length;
			totalScanned += gameRows.length;

			for (const { gameId } of gameRows) {
				cursor = gameId;

				// 1. Check if online snapshot already exists
				const onlineCheckSql = `
					SELECT 1
					FROM match_decks md
					WHERE md.match_id IN (
						SELECT id FROM matches WHERE game_id = $1 AND format_id = $2
					)
					  AND md.snapshot_source = 'online'
					LIMIT 1
				`;
				const rawOnlineRows = await this.readonlyClient.query(onlineCheckSql, [
					gameId,
					options.formatId,
				]);
				const onlineRows = extractRows(rawOnlineRows);
				if (onlineRows.length > 0) {
					report.skipped.onlineSnapshotExists++;
					if (firstFailedGameId === undefined) lastSafeGameId = gameId;
					continue;
				}

				// 2. Check if both matches already have backfill snapshots
				const backfilledCheckSql = `
					SELECT count(md.match_id)::int AS count
					FROM match_decks md
					WHERE md.match_id IN (
						SELECT id FROM matches WHERE game_id = $1 AND format_id = $2
					)
				`;
				const rawBackfillRows = await this.readonlyClient.query(backfilledCheckSql, [
					gameId,
					options.formatId,
				]);
				const backfillRows = extractRows<{ count: number }>(rawBackfillRows);
				const backfilledCount = Number(backfillRows[0]?.count ?? 0);
				if (backfilledCount >= 2) {
					report.skipped.alreadyBackfilled++;
					if (firstFailedGameId === undefined) lastSafeGameId = gameId;
					continue;
				}

				// 3. Query the two match perspectives
				const matchesSql = `
					SELECT
						m.id,
						m.user_id AS "userId",
						m.player_names AS "playerNames",
						m.opponent_names AS "opponentNames",
						m.format_id AS "formatId"
					FROM matches m
					WHERE m.game_id = $1
					  AND m.format_id = $2
					  AND m.anulled = false
					  AND m.deleted_at IS NULL
					ORDER BY m.id ASC
				`;
				const rawMatches = await this.readonlyClient.query(matchesSql, [gameId, options.formatId]);
				const matchPerspectives = extractRows<{
					id: string;
					userId: string;
					playerNames: string | string[];
					opponentNames: string | string[];
					formatId: string;
				}>(rawMatches);

				if (
					matchPerspectives.length !== 2 ||
					matchPerspectives[0].userId === matchPerspectives[1].userId
				) {
					report.skipped.invalidPerspectives++;
					if (firstFailedGameId === undefined) lastSafeGameId = gameId;
					continue;
				}

				// 4. Query G1 duel replay
				const replaySql = `
					SELECT dr.id, dr.replay_data AS "replayData"
					FROM duel_replays dr
					WHERE dr.game_id = $1
					  AND dr.format_id = $2
					  AND dr.duel_index = 1
					LIMIT 1
				`;
				const rawReplays = await this.readonlyClient.query(replaySql, [gameId, options.formatId]);
				const replayRows = extractRows<{ id: string; replayData: Buffer }>(rawReplays);

				if (replayRows.length === 0 || !replayRows[0].replayData) {
					report.skipped.missingG1Replay++;
					if (firstFailedGameId === undefined) lastSafeGameId = gameId;
					continue;
				}

				// 5. Extract decks from G1 replay
				const extracted = this.extractor.extractFromYrp(replayRows[0].replayData);
				if (!extracted) {
					report.skipped.invalidReplayOrDeck++;
					if (firstFailedGameId === undefined) lastSafeGameId = gameId;
					continue;
				}

				// 6. Match player perspectives with host/client names
				const m1 = matchPerspectives[0];
				const m2 = matchPerspectives[1];
				const m1Names = Array.isArray(m1.playerNames)
					? m1.playerNames
					: (m1.playerNames ?? "").split(",").map((s) => s.trim());
				const m2Names = Array.isArray(m2.playerNames)
					? m2.playerNames
					: (m2.playerNames ?? "").split(",").map((s) => s.trim());

				let m1Deck: typeof extracted.hostDeck | null = null;
				let m2Deck: typeof extracted.clientDeck | null = null;

				const m1IsHost = m1Names.includes(extracted.hostName);
				const m2IsClient = m2Names.includes(extracted.clientName);
				const m1IsClient = m1Names.includes(extracted.clientName);
				const m2IsHost = m2Names.includes(extracted.hostName);

				if (m1IsHost && m2IsClient && !m1IsClient && !m2IsHost) {
					m1Deck = extracted.hostDeck;
					m2Deck = extracted.clientDeck;
				} else if (m1IsClient && m2IsHost && !m1IsHost && !m2IsClient) {
					m1Deck = extracted.clientDeck;
					m2Deck = extracted.hostDeck;
				} else {
					report.skipped.ambiguousIdentity++;
					if (firstFailedGameId === undefined) lastSafeGameId = gameId;
					continue;
				}

				report.candidates++;

				// 7. Classify decks
				const m1Classification = classifyDeck(options.formatId, m1Deck.mainCards, aliasMap);
				const m2Classification = classifyDeck(options.formatId, m2Deck.mainCards, aliasMap);

				// 8. Write if not dry-run
				if (!options.dryRun) {
					const insertSql = `
						INSERT INTO match_decks (
							match_id, format_id, deck_type_code, classifier_version,
							snapshot_source, main_cards, extra_cards, side_cards
						) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
						ON CONFLICT (match_id) DO NOTHING
					`;

					try {
						await this.executeInTransaction(async (client) => {
							await client.query(insertSql, [
								m1.id,
								options.formatId,
								m1Classification.deckTypeCode,
								m1Classification.classifierVersion,
								"replay_backfill",
								m1Deck.mainCards,
								m1Deck.extraCards,
								null,
							]);

							await client.query(insertSql, [
								m2.id,
								options.formatId,
								m2Classification.deckTypeCode,
								m2Classification.classifierVersion,
								"replay_backfill",
								m2Deck.mainCards,
								m2Deck.extraCards,
								null,
							]);
						});
						report.successful++;
						if (firstFailedGameId === undefined) lastSafeGameId = gameId;
					} catch (_writeErr) {
						if (firstFailedGameId === undefined) firstFailedGameId = gameId;
						report.failedGameIds.push(gameId);
						report.skipped.writeFailed = (report.skipped.writeFailed ?? 0) + 1;
						continue;
					}
				} else {
					report.successful++;
					if (firstFailedGameId === undefined) lastSafeGameId = gameId;
				}
			}

			if (gameRows.length < currentLimit) {
				break;
			}
		}

		report.lastGameId = cursor;
		report.resumeCursor = firstFailedGameId !== undefined ? lastSafeGameId : cursor;

		return report;
	}
}
