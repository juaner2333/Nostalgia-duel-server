import { ReplayG1DeckExtractor } from "../../domain/backfill/ReplayG1DeckExtractor";
import { classifyDeck } from "../../domain/classifier/DeckClassifier";
import { CardAliasProvider } from "../../../stats/persistence/RankedMatchPersistenceService";

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

	return { valid: true };
}

export interface BackfillOptions {
	formatId: string;
	dryRun: boolean;
	batchSize?: number;
	limit?: number;
}

export interface BackfillReport {
	formatId: string;
	dryRun: boolean;
	scannedGames: number;
	candidates: number;
	successful: number;
	skipped: {
		onlineSnapshotExists: number;
		alreadyBackfilled: number;
		invalidPerspectives: number;
		missingG1Replay: number;
		invalidReplayOrDeck: number;
		ambiguousIdentity: number;
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
		private readonly aliasProvider?: CardAliasProvider,
	) {}

	async run(options: BackfillOptions): Promise<BackfillReport> {
		const report: BackfillReport = {
			formatId: options.formatId,
			dryRun: options.dryRun,
			scannedGames: 0,
			candidates: 0,
			successful: 0,
			skipped: {
				onlineSnapshotExists: 0,
				alreadyBackfilled: 0,
				invalidPerspectives: 0,
				missingG1Replay: 0,
				invalidReplayOrDeck: 0,
				ambiguousIdentity: 0,
			},
		};

		const aliasMap = this.aliasProvider
			? await this.aliasProvider.getAliases(options.formatId)
			: undefined;

		const gamesSql = `
			SELECT DISTINCT m.game_id AS "gameId"
			FROM matches m
			WHERE m.format_id = $1
			  AND m.anulled = false
			  AND m.deleted_at IS NULL
			ORDER BY m.game_id ASC
			${options.limit ? `LIMIT ${options.limit}` : ""}
		`;
		const gameRows: Array<{ gameId: string }> = await this.readonlyClient.query(gamesSql, [
			options.formatId,
		]);

		report.scannedGames = gameRows.length;

		for (const { gameId } of gameRows) {
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
			const onlineRows = await this.readonlyClient.query(onlineCheckSql, [
				gameId,
				options.formatId,
			]);
			if (onlineRows && onlineRows.length > 0) {
				report.skipped.onlineSnapshotExists++;
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
			const backfillRows = await this.readonlyClient.query(backfilledCheckSql, [
				gameId,
				options.formatId,
			]);
			const backfilledCount = Number(backfillRows[0]?.count ?? 0);
			if (backfilledCount >= 2) {
				report.skipped.alreadyBackfilled++;
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
			const matchPerspectives: Array<{
				id: string;
				userId: string;
				playerNames: string | string[];
				opponentNames: string | string[];
				formatId: string;
			}> = await this.readonlyClient.query(matchesSql, [gameId, options.formatId]);

			if (
				matchPerspectives.length !== 2 ||
				matchPerspectives[0].userId === matchPerspectives[1].userId
			) {
				report.skipped.invalidPerspectives++;
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
			const replayRows: Array<{ id: string; replayData: Buffer }> = await this.readonlyClient.query(
				replaySql,
				[gameId, options.formatId],
			);

			if (!replayRows || replayRows.length === 0 || !replayRows[0].replayData) {
				report.skipped.missingG1Replay++;
				continue;
			}

			// 5. Extract decks from G1 replay
			const extracted = this.extractor.extractFromYrp(replayRows[0].replayData);
			if (!extracted) {
				report.skipped.invalidReplayOrDeck++;
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

				await this.writeClient.query(insertSql, [
					m1.id,
					options.formatId,
					m1Classification.deckTypeCode,
					m1Classification.classifierVersion,
					"replay_backfill",
					m1Deck.mainCards,
					m1Deck.extraCards,
					null,
				]);

				await this.writeClient.query(insertSql, [
					m2.id,
					options.formatId,
					m2Classification.deckTypeCode,
					m2Classification.classifierVersion,
					"replay_backfill",
					m2Deck.mainCards,
					m2Deck.extraCards,
					null,
				]);
			}

			report.successful++;
		}

		return report;
	}
}
