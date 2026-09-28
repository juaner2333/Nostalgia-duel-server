import { ReplayDuelSeatExtractor } from "../../domain/backfill/ReplayDuelSeatExtractor";
import {
	PostgresConnectionConfig,
	Queryable,
	extractRows,
	sanitizeDatabaseError,
} from "../../../../deck/application/backfill/ReplayDeckBackfillService";

export interface DuelSeatBackfillOptions {
	formatId: string;
	dryRun: boolean;
	batchSize?: number;
	limit?: number;
	cursor?: string;
}

export interface DuelSeatBackfillReport {
	formatId: string;
	dryRun: boolean;
	scannedGames: number;
	candidates: number;
	successfulGames: number;
	seatsConfirmedDuels: number;
	indexOnlyConfirmedDuels: number;
	unknownDuels: number;
	conflictDuels: number;
	lastGameId?: string;
	resumeCursor?: string;
	failedGameIds: string[];
	skipped: {
		alreadyConfirmed: number;
		invalidPerspectives: number;
		ambiguousIdentity: number;
		writeFailed?: number;
	};
}

export async function verifyDuelSeatConnectionPermissions(
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
				"SELECT has_table_privilege(current_user, 'duels', 'UPDATE') AS can_update",
			);
			const canUpdate = extractRows<{ can_update?: boolean }>(writeRes)[0]?.can_update;
			if (canUpdate === false) {
				return {
					valid: false,
					error: "WRITE user does not have UPDATE privilege on duels table",
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

export class ReplayDuelSeatBackfillService {
	private readonly extractor = new ReplayDuelSeatExtractor();

	constructor(
		private readonly readonlyClient: Queryable,
		private readonly writeClient: Queryable,
	) {}

	private async executeInTransaction(fn: (client: Queryable) => Promise<void>): Promise<void> {
		const pool = this.writeClient as {
			connect?: () => Promise<{
				query: (sql: string, params?: unknown[]) => Promise<unknown>;
				release: () => void;
			}>;
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

	async run(options: DuelSeatBackfillOptions): Promise<DuelSeatBackfillReport> {
		const report: DuelSeatBackfillReport = {
			formatId: options.formatId,
			dryRun: options.dryRun,
			scannedGames: 0,
			candidates: 0,
			successfulGames: 0,
			seatsConfirmedDuels: 0,
			indexOnlyConfirmedDuels: 0,
			unknownDuels: 0,
			conflictDuels: 0,
			failedGameIds: [],
			skipped: {
				alreadyConfirmed: 0,
				invalidPerspectives: 0,
				ambiguousIdentity: 0,
				writeFailed: 0,
			},
		};

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

				// 1. Query the match perspectives
				const matchesSql = `
					SELECT
						m.id,
						m.user_id AS "userId",
						m.player_names AS "playerNames",
						m.opponent_names AS "opponentNames"
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
				}>(rawMatches);

				if (matchPerspectives.length !== 2) {
					report.skipped.invalidPerspectives++;
					if (firstFailedGameId === undefined) lastSafeGameId = gameId;
					continue;
				}

				const [m1, m2] = matchPerspectives;
				if (m1.userId === m2.userId) {
					report.skipped.invalidPerspectives++;
					if (firstFailedGameId === undefined) lastSafeGameId = gameId;
					continue;
				}

				const p1Name = Array.isArray(m1.playerNames)
					? m1.playerNames[0]
					: String(m1.playerNames).split(",")[0];
				const p2Name = Array.isArray(m2.playerNames)
					? m2.playerNames[0]
					: String(m2.playerNames).split(",")[0];

				if (!p1Name || !p2Name || p1Name.trim() === p2Name.trim()) {
					report.skipped.ambiguousIdentity++;
					if (firstFailedGameId === undefined) lastSafeGameId = gameId;
					continue;
				}

				// 2. Query duels for both match perspectives
				const duelsSql = `
					SELECT
						d.id,
						d.match_id AS "matchId",
						d.user_id AS "userId",
						d.replay_id AS "replayId",
						d.duel_index AS "duelIndex",
						d.is_first AS "isFirst"
					FROM duels d
					WHERE d.match_id IN ($1, $2)
					  AND d.deleted_at IS NULL
					ORDER BY d.created_at ASC, d.id ASC
				`;
				const rawDuels = await this.readonlyClient.query(duelsSql, [m1.id, m2.id]);
				const duels = extractRows<{
					id: string;
					matchId: string;
					userId: string;
					replayId: string;
					duelIndex: number | null;
					isFirst: boolean | null;
				}>(rawDuels);

				if (duels.length === 0) {
					if (firstFailedGameId === undefined) lastSafeGameId = gameId;
					continue;
				}

				report.candidates++;

				// Query distinct duel_replays matching duels' replay_id
				const replayIds = Array.from(new Set(duels.map((d) => d.replayId)));
				const replaysSql = `
					SELECT
						r.id,
						r.game_id AS "gameId",
						r.format_id AS "formatId",
						r.duel_index AS "duelIndex",
						r.replay_data AS "replayData"
					FROM duel_replays r
					WHERE r.id = ANY($1)
					  AND r.game_id = $2
					  AND r.format_id = $3
				`;
				const rawReplays = await this.readonlyClient.query(replaysSql, [
					replayIds,
					gameId,
					options.formatId,
				]);
				const replays = extractRows<{
					id: string;
					gameId: string;
					formatId: string;
					duelIndex: number;
					replayData: Buffer | Uint8Array;
				}>(rawReplays);
				const replayMap = new Map(replays.map((r) => [r.id, r]));

				interface DuelUpdate {
					duelId: string;
					duelIndex: number;
					isFirst: boolean | null;
				}
				const updates: DuelUpdate[] = [];
				let gameHasConflict = false;
				let gameHasUpdate = false;
				let gameSeatsConfirmed = 0;
				let gameIndexOnlyConfirmed = 0;
				let gameAlreadyConfirmed = 0;

				// Process duels grouped by replay_id
				for (const replayId of replayIds) {
					const duelsForReplay = duels.filter((d) => d.replayId === replayId);
					const replay = replayMap.get(replayId);

					if (!replay) {
						// Placeholder UUID or missing replay in duel_replays -> unknown
						report.unknownDuels += duelsForReplay.length;
						continue;
					}

					// Validate replay duelIndex
					const validReplayIndex =
						typeof replay.duelIndex === "number" && replay.duelIndex >= 1 && replay.duelIndex <= 3;

					if (!validReplayIndex) {
						report.unknownDuels += duelsForReplay.length;
						continue;
					}

					const hasBothPerspectives =
						duelsForReplay.length === 2 &&
						duelsForReplay.some((d) => d.userId === m1.userId) &&
						duelsForReplay.some((d) => d.userId === m2.userId);

					const extracted = this.extractor.extractFromYrp(replay.replayData);
					const seats = extracted
						? this.extractor.resolvePlayerSeats(extracted, p1Name, p2Name)
						: null;

					if (seats && hasBothPerspectives) {
						// Both duel_index and is_first can be confirmed
						for (const d of duelsForReplay) {
							const targetFirst =
								d.userId === m1.userId ? seats.player1IsFirst : seats.player2IsFirst;
							const targetIndex = replay.duelIndex;

							// Check conflict with existing trusted online values
							if (
								(d.duelIndex !== null && d.duelIndex !== targetIndex) ||
								(d.isFirst !== null && d.isFirst !== targetFirst)
							) {
								report.conflictDuels++;
								gameHasConflict = true;
								continue;
							}

							if (d.duelIndex === targetIndex && d.isFirst === targetFirst) {
								gameAlreadyConfirmed++;
							} else {
								updates.push({
									duelId: d.id,
									duelIndex: targetIndex,
									isFirst: targetFirst,
								});
								gameSeatsConfirmed++;
								gameHasUpdate = true;
							}
						}
					} else {
						// Only duel_index can be confirmed; is_first stays unchanged or NULL
						for (const d of duelsForReplay) {
							const targetIndex = replay.duelIndex;

							if (d.duelIndex !== null && d.duelIndex !== targetIndex) {
								report.conflictDuels++;
								gameHasConflict = true;
								continue;
							}

							if (d.duelIndex === targetIndex) {
								gameAlreadyConfirmed++;
							} else if (d.duelIndex === null) {
								updates.push({
									duelId: d.id,
									duelIndex: targetIndex,
									isFirst: d.isFirst ?? null,
								});
								gameIndexOnlyConfirmed++;
								gameHasUpdate = true;
							}
						}
					}
				}

				if (gameHasConflict) {
					// Game has conflict: do not write any updates; discard candidate counts for this game
					if (firstFailedGameId === undefined) lastSafeGameId = gameId;
					continue;
				}

				report.skipped.alreadyConfirmed += gameAlreadyConfirmed;
				report.seatsConfirmedDuels += gameSeatsConfirmed;
				report.indexOnlyConfirmedDuels += gameIndexOnlyConfirmed;

				if (!options.dryRun && updates.length > 0) {
					try {
						await this.executeInTransaction(async (client) => {
							for (const u of updates) {
								await client.query(
									`
									UPDATE duels
									SET duel_index = $1, is_first = $2, updated_at = NOW()
									WHERE id = $3
								`,
									[u.duelIndex, u.isFirst, u.duelId],
								);
							}
						});
						report.successfulGames++;
						if (firstFailedGameId === undefined) lastSafeGameId = gameId;
					} catch (writeErr) {
						report.skipped.writeFailed = (report.skipped.writeFailed ?? 0) + 1;
						report.failedGameIds.push(gameId);
						if (firstFailedGameId === undefined) firstFailedGameId = gameId;
					}
				} else if (options.dryRun && gameHasUpdate) {
					report.successfulGames++;
					if (firstFailedGameId === undefined) lastSafeGameId = gameId;
				} else if (firstFailedGameId === undefined) {
					lastSafeGameId = gameId;
				}
			}
		}

		report.lastGameId = cursor;
		report.resumeCursor = firstFailedGameId ?? lastSafeGameId;
		return report;
	}
}
