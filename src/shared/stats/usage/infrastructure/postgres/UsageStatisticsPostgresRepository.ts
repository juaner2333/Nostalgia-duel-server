import { DataSource, QueryRunner } from "typeorm";
import {
	FormatWindowFacts,
	UsageStatisticsRepository,
} from "../../application/RebuildUsageStatisticsUseCase";
import {
	UsageQueryRepository,
	UsageSnapshotData,
} from "../../application/GetUsageStatisticsUseCase";
import { UsageStatRunData, UsageDeckRowData } from "../../domain/UsageConsistencyValidator";
import { CardUsageRow } from "../../domain/CardUsageCalculator";
import { PlayerMatchDeckSnapshot } from "../../domain/DeckUsageCalculator";
import {
	DeckMatchupRowData,
	RawPhysicalMatchPerspective,
} from "@shared/stats/matchup/domain/DeckMatchupCalculator";
import { MatchupQueryRepository } from "@shared/stats/matchup/application/GetDeckMatchupStatsUseCase";
import { DECK_TYPE_CATALOG } from "@shared/deck/domain/classifier/DeckClassifier";

export class UsageStatisticsPostgresRepository
	implements UsageStatisticsRepository, UsageQueryRepository, MatchupQueryRepository
{
	private readonly lockRunners = new Map<string, QueryRunner>();

	constructor(private readonly dataSource: DataSource) {}

	public async tryAcquireAdvisoryLock(formatId: string): Promise<boolean> {
		const lockKey = `usage_stat_runs:${formatId}`;
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		try {
			const result = await queryRunner.query(
				"SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
				[lockKey],
			);
			if (result[0]?.locked === true) {
				this.lockRunners.set(formatId, queryRunner);
				return true;
			}
			await queryRunner.release();
			return false;
		} catch (error) {
			await queryRunner.release();
			throw error;
		}
	}

	public async releaseAdvisoryLock(formatId: string): Promise<void> {
		const lockKey = `usage_stat_runs:${formatId}`;
		const queryRunner = this.lockRunners.get(formatId);
		if (!queryRunner) {
			return;
		}
		try {
			await queryRunner.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
		} finally {
			await queryRunner.release();
			this.lockRunners.delete(formatId);
		}
	}

	public async readFormatWindowFacts(
		formatId: string,
		startInclusive: string,
		endExclusive: string,
		options: { includePhysicalMatchPerspectives: boolean; snapshotBatchSize?: number },
	): Promise<FormatWindowFacts> {
		const batchSize = Math.max(1, options.snapshotBatchSize ?? 500);
		let cursorDate: string | null = null;
		let cursorId: string | null = null;

		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction("REPEATABLE READ");

		try {
			const snapshots: PlayerMatchDeckSnapshot[] = [];
			while (true) {
				const rows: {
					match_id: string;
					format_id: string;
					date_str: string;
					deck_type_code: string | null;
					main_cards: number[] | null;
					extra_cards: number[] | null;
					side_cards: number[] | null;
				}[] = await queryRunner.query(
					`
					SELECT 
						m.id AS match_id,
						m.format_id,
						to_char(m.date, 'YYYY-MM-DD HH24:MI:SS.US') AS date_str,
						md.deck_type_code,
						md.main_cards,
						md.extra_cards,
						md.side_cards
					FROM matches m
					LEFT JOIN match_decks md ON m.id = md.match_id AND m.format_id = md.format_id
					WHERE m.format_id = $1
					  AND m.date >= $2::timestamp
					  AND m.date < $3::timestamp
					  AND m.deleted_at IS NULL
					  AND m.anulled = false
					  AND (
					      $4::timestamp IS NULL
					      OR m.date > $4::timestamp
					      OR (m.date = $4::timestamp AND m.id > $5)
					  )
					ORDER BY m.date ASC, m.id ASC
					LIMIT $6;
				`,
					[formatId, startInclusive, endExclusive, cursorDate, cursorId, batchSize],
				);

				if (!rows || rows.length === 0) {
					break;
				}

				for (const row of rows) {
					snapshots.push({
						matchId: row.match_id,
						formatId: row.format_id,
						deckTypeCode: row.deck_type_code ?? "",
						mainCards: row.main_cards ?? [],
						extraCards: row.extra_cards ?? [],
						sideCards: row.side_cards,
					});
				}

				if (rows.length < batchSize) {
					break;
				}

				const lastRow = rows[rows.length - 1];
				cursorDate = lastRow.date_str;
				cursorId = lastRow.match_id;
			}

			let perspectives: RawPhysicalMatchPerspective[] = [];
			if (options.includePhysicalMatchPerspectives) {
				const rows: {
					game_id: string;
					match_id: string;
					user_id: string;
					format_id: string;
					winner: boolean;
					player_score: number;
					opponent_score: number;
					is_annulled: boolean;
					is_deleted: boolean;
					deck_type_code: string | null;
					g1_is_first: boolean | null;
				}[] = await queryRunner.query(
					`
					SELECT 
						m.game_id,
						m.id AS match_id,
						m.user_id,
						m.format_id,
						m.winner,
						m.player_score,
						m.opponent_score,
						m.anulled AS is_annulled,
						(m.deleted_at IS NOT NULL) AS is_deleted,
						md.deck_type_code,
						g1.is_first AS g1_is_first
					FROM matches m
					LEFT JOIN match_decks md ON m.id = md.match_id AND m.format_id = md.format_id
					LEFT JOIN duels g1 ON m.id = g1.match_id AND g1.duel_index = 1 AND g1.deleted_at IS NULL
					WHERE m.format_id = $1
					  AND m.date >= $2::timestamp
					  AND m.date < $3::timestamp
					  AND m.deleted_at IS NULL
					  AND m.anulled = false
					ORDER BY m.game_id ASC, m.id ASC;
				`,
					[formatId, startInclusive, endExclusive],
				);

				perspectives = (rows ?? []).map((r) => ({
					gameId: r.game_id,
					matchId: r.match_id,
					userId: r.user_id,
					formatId: r.format_id,
					winner: r.winner,
					playerScore: Number(r.player_score),
					opponentScore: Number(r.opponent_score),
					isAnnulled: r.is_annulled,
					isDeleted: r.is_deleted,
					deckTypeCode: r.deck_type_code,
					g1IsFirst: r.g1_is_first,
				}));
			}

			await queryRunner.commitTransaction();
			return { snapshots, perspectives };
		} catch (error) {
			if (queryRunner.isTransactionActive) {
				await queryRunner.rollbackTransaction();
			}
			throw error;
		} finally {
			await queryRunner.release();
		}
	}

	public async findRun(formatId: string, windowStart: string): Promise<UsageStatRunData | null> {
		const rows: {
			format_id: string;
			window_start: string;
			window_end_exclusive: string;
			data_end_exclusive: string;
			published_at: Date;
			total_decks: string | number;
			side_known_decks: string | number;
			matchups_evaluated: boolean;
		}[] = await this.dataSource.query(
			`
			SELECT 
				format_id,
				window_start::text,
				window_end_exclusive::text,
				data_end_exclusive::text,
				published_at,
				total_decks,
				side_known_decks,
				matchups_evaluated
			FROM usage_stat_runs
			WHERE format_id = $1 AND window_start = $2::date;
		`,
			[formatId, windowStart],
		);

		if (!rows || rows.length === 0) {
			return null;
		}

		const r = rows[0];
		return {
			formatId: r.format_id,
			windowStart: r.window_start,
			windowEndExclusive: r.window_end_exclusive,
			dataEndExclusive: r.data_end_exclusive,
			publishedAt: r.published_at,
			totalDecks: Number(r.total_decks),
			sideKnownDecks: Number(r.side_known_decks),
			matchupsEvaluated: r.matchups_evaluated === true,
		};
	}

	public async listPublishedRuns(formatId: string): Promise<UsageStatRunData[]> {
		const rows: {
			format_id: string;
			window_start: string;
			window_end_exclusive: string;
			data_end_exclusive: string;
			published_at: Date;
			total_decks: string | number;
			side_known_decks: string | number;
			matchups_evaluated: boolean;
		}[] = await this.dataSource.query(
			`
			SELECT 
				format_id,
				window_start::text,
				window_end_exclusive::text,
				data_end_exclusive::text,
				published_at,
				total_decks,
				side_known_decks,
				matchups_evaluated
			FROM usage_stat_runs
			WHERE format_id = $1
			ORDER BY window_start DESC;
		`,
			[formatId],
		);

		return (rows ?? []).map((r) => ({
			formatId: r.format_id,
			windowStart: r.window_start,
			windowEndExclusive: r.window_end_exclusive,
			dataEndExclusive: r.data_end_exclusive,
			publishedAt: r.published_at,
			totalDecks: Number(r.total_decks),
			sideKnownDecks: Number(r.side_known_decks),
			matchupsEvaluated: r.matchups_evaluated === true,
		}));
	}

	public async publishPeriodStatistics(
		run: UsageStatRunData,
		deckRows: readonly UsageDeckRowData[],
		cardRows: readonly CardUsageRow[],
		matchupRows: readonly DeckMatchupRowData[] = [],
	): Promise<void> {
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			// 1. Delete details for this format and window
			if (run.formatId === "1109") {
				await queryRunner.query(
					`DELETE FROM "stats_deck_top_players" WHERE format_id = $1 AND window_start = $2::date`,
					[run.formatId, run.windowStart],
				);
				await queryRunner.query(
					`DELETE FROM "stats_deck_detail_matchups" WHERE format_id = $1 AND window_start = $2::date`,
					[run.formatId, run.windowStart],
				);
				await queryRunner.query(
					`DELETE FROM "stats_deck_matchups" WHERE format_id = $1 AND window_start = $2::date`,
					[run.formatId, run.windowStart],
				);
			}
			await queryRunner.query(
				`DELETE FROM "usage_card_rows" WHERE format_id = $1 AND window_start = $2::date`,
				[run.formatId, run.windowStart],
			);
			await queryRunner.query(
				`DELETE FROM "usage_deck_rows" WHERE format_id = $1 AND window_start = $2::date`,
				[run.formatId, run.windowStart],
			);

			// 2. Upsert summary header
			await queryRunner.query(
				`
				INSERT INTO "usage_stat_runs" (
					"format_id", "window_start", "window_end_exclusive", "data_end_exclusive",
					"published_at", "total_decks", "side_known_decks", "matchups_evaluated"
				) VALUES ($1, $2::date, $3::date, $4::date, $5, $6, $7, $8)
				ON CONFLICT ("format_id", "window_start") DO UPDATE SET
					"window_end_exclusive" = EXCLUDED."window_end_exclusive",
					"data_end_exclusive" = EXCLUDED."data_end_exclusive",
					"published_at" = EXCLUDED."published_at",
					"total_decks" = EXCLUDED."total_decks",
					"side_known_decks" = EXCLUDED."side_known_decks",
					"matchups_evaluated" = EXCLUDED."matchups_evaluated";
			`,
				[
					run.formatId,
					run.windowStart,
					run.windowEndExclusive,
					run.dataEndExclusive,
					run.publishedAt,
					run.totalDecks,
					run.sideKnownDecks,
					run.matchupsEvaluated === true,
				],
			);

			// 3. Batch insert deck rows
			const deckBatchSize = 100;
			for (let i = 0; i < deckRows.length; i += deckBatchSize) {
				const chunk = deckRows.slice(i, i + deckBatchSize);
				const valuesClauses: string[] = [];
				const params: unknown[] = [];
				chunk.forEach((row, idx) => {
					const base = idx * 4;
					valuesClauses.push(`($${base + 1}, $${base + 2}::date, $${base + 3}, $${base + 4})`);
					params.push(row.formatId, row.windowStart, row.deckTypeCode, row.deckCount);
				});
				await queryRunner.query(
					`INSERT INTO "usage_deck_rows" ("format_id", "window_start", "deck_type_code", "deck_count")
					 VALUES ${valuesClauses.join(", ")}`,
					params,
				);
			}

			// 4. Batch insert card rows
			const cardBatchSize = 100;
			for (let i = 0; i < cardRows.length; i += cardBatchSize) {
				const chunk = cardRows.slice(i, i + cardBatchSize);
				const valuesClauses: string[] = [];
				const params: unknown[] = [];
				chunk.forEach((row, idx) => {
					const base = idx * 8;
					valuesClauses.push(
						`($${base + 1}, $${base + 2}::date, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
					);
					params.push(
						row.formatId,
						row.windowStart,
						row.metric,
						row.cardId,
						row.deckCount,
						row.copies1,
						row.copies2,
						row.copies3,
					);
				});
				await queryRunner.query(
					`INSERT INTO "usage_card_rows" (
						"format_id", "window_start", "metric", "card_id", "deck_count",
						"copies_1", "copies_2", "copies_3"
					 ) VALUES ${valuesClauses.join(", ")}`,
					params,
				);
			}

			// 5. Batch insert matchup rows (1109 only)
			if (run.formatId === "1109" && matchupRows.length > 0) {
				const matchupBatchSize = 100;
				for (let i = 0; i < matchupRows.length; i += matchupBatchSize) {
					const chunk = matchupRows.slice(i, i + matchupBatchSize);
					const valuesClauses: string[] = [];
					const params: unknown[] = [];
					chunk.forEach((row, idx) => {
						const base = idx * 6;
						valuesClauses.push(
							`($${base + 1}, $${base + 2}::date, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
						);
						params.push(
							row.formatId,
							row.windowStart,
							row.firstDeckCode,
							row.secondDeckCode,
							row.matchCount,
							row.firstWins,
						);
					});
					await queryRunner.query(
						`INSERT INTO "stats_deck_matchups" (
							"format_id", "window_start", "first_deck_code", "second_deck_code", "match_count", "first_wins"
						 ) VALUES ${valuesClauses.join(", ")}`,
						params,
					);
				}
			}

			// 6. Verify checksum: COALESCE(SUM(match_count), 0) must equal expected sum
			if (run.formatId === "1109") {
				const sumRes = await queryRunner.query(
					`SELECT COALESCE(SUM(match_count), 0)::bigint AS sum_matches 
					 FROM "stats_deck_matchups" 
					 WHERE format_id = $1 AND window_start = $2::date`,
					[run.formatId, run.windowStart],
				);
				const actualSum = Number(sumRes[0]?.sum_matches ?? 0);
				const expectedSum = matchupRows.reduce((acc, r) => acc + r.matchCount, 0);
				if (actualSum !== expectedSum) {
					throw new Error(
						`Published matchup match_count sum (${actualSum}) does not match expected (${expectedSum})`,
					);
				}

				// 7. 预聚合卡组详情表（仅 1109）：全具名对手 8 计数与专精玩家 Top10
				const namedCodes = (DECK_TYPE_CATALOG["1109"] ?? [])
					.filter((t) => t.code !== "OTHERS")
					.map((t) => t.code);

				const startTimestamp = run.windowStart.includes(":")
					? run.windowStart
					: `${run.windowStart} 00:00:00`;
				const endTimestamp = run.dataEndExclusive.includes(":")
					? run.dataEndExclusive
					: `${run.dataEndExclusive} 00:00:00`;

				const commonCte = `
					WITH candidate_games AS (
						SELECT DISTINCT m.game_id
						FROM matches m
						WHERE m.format_id = $1
						  AND m.date >= $2::timestamp
						  AND m.date < $3::timestamp
						  AND m.deleted_at IS NULL
						  AND m.anulled = false
					),
					raw_perspectives AS (
						SELECT 
							m.game_id,
							m.id AS match_id,
							m.user_id,
							m.winner,
							m.player_score,
							m.opponent_score,
							m.anulled,
							m.deleted_at,
							m.date,
							COUNT(*) OVER (PARTITION BY m.game_id) AS game_record_count
						FROM matches m
						WHERE m.format_id = $1
						  AND m.game_id IN (SELECT game_id FROM candidate_games)
					),
					paired_perspectives AS (
						SELECT
							m1.game_id,
							m1.match_id,
							m1.user_id,
							m1.winner,
							m2.match_id AS opp_match_id,
							m2.user_id AS opp_user_id
						FROM raw_perspectives m1
						JOIN raw_perspectives m2 ON m1.game_id = m2.game_id AND m1.match_id <> m2.match_id
						WHERE m1.game_record_count = 2
						  AND m1.user_id <> m2.user_id
						  AND m1.anulled = false
						  AND m1.deleted_at IS NULL
						  AND m2.anulled = false
						  AND m2.deleted_at IS NULL
						  AND m1.date >= $2::timestamp
						  AND m1.date < $3::timestamp
						  AND m2.date >= $2::timestamp
						  AND m2.date < $3::timestamp
						  AND m1.winner <> m2.winner
						  AND m1.player_score = m2.opponent_score
						  AND m1.opponent_score = m2.player_score
					),
					valid_deck_perspectives AS (
						SELECT
							p.game_id,
							p.match_id,
							p.user_id,
							p.winner,
							md1.deck_type_code,
							md2.deck_type_code AS opp_deck_type_code,
							CASE
								WHEN d1.id IS NOT NULL AND d2.id IS NOT NULL
								 AND d1.is_first IS NOT NULL AND d2.is_first IS NOT NULL
								 AND d1.is_first <> d2.is_first
								THEN (CASE WHEN d1.is_first = true THEN 1 WHEN d1.is_first = false THEN 2 ELSE 0 END)
								ELSE 0
							END AS seat_code
						FROM paired_perspectives p
						JOIN match_decks md1 ON md1.match_id = p.match_id AND md1.format_id = $1
						LEFT JOIN match_decks md2 ON md2.match_id = p.opp_match_id AND md2.format_id = $1
						LEFT JOIN duels d1 ON d1.match_id = p.match_id 
										   AND d1.duel_index = 1 
										   AND d1.deleted_at IS NULL 
										   AND d1.game_id = p.game_id 
										   AND d1.user_id = p.user_id
						LEFT JOIN duels d2 ON d2.match_id = p.opp_match_id 
										   AND d2.duel_index = 1 
										   AND d2.deleted_at IS NULL 
										   AND d2.game_id = p.game_id 
										   AND d2.user_id = p.opp_user_id
						WHERE md1.deck_type_code = ANY($4::varchar[])
						  AND (md2.deck_type_code IS NULL OR (md2.deck_type_code <> 'OTHERS' AND md2.deck_type_code = ANY($4::varchar[])))
					)
				`;

				// 7a. 写入 stats_deck_detail_matchups
				await queryRunner.query(
					`
					${commonCte}
					INSERT INTO "stats_deck_detail_matchups" (
						"format_id", "window_start", "deck_type_code", "opp_deck_type_code",
						"matches", "match_wins", "first_matches", "first_wins",
						"second_matches", "second_wins", "unknown_seat_matches", "unknown_seat_wins"
					)
					SELECT
						$1,
						$5::date,
						v.deck_type_code,
						COALESCE(v.opp_deck_type_code, 'unknown'),
						COUNT(*)::bigint,
						COUNT(CASE WHEN v.winner = true THEN 1 END)::bigint,
						COUNT(CASE WHEN v.seat_code = 1 THEN 1 END)::bigint,
						COUNT(CASE WHEN v.seat_code = 1 AND v.winner = true THEN 1 END)::bigint,
						COUNT(CASE WHEN v.seat_code = 2 THEN 1 END)::bigint,
						COUNT(CASE WHEN v.seat_code = 2 AND v.winner = true THEN 1 END)::bigint,
						COUNT(CASE WHEN v.seat_code = 0 THEN 1 END)::bigint,
						COUNT(CASE WHEN v.seat_code = 0 AND v.winner = true THEN 1 END)::bigint
					FROM valid_deck_perspectives v
					GROUP BY v.deck_type_code, COALESCE(v.opp_deck_type_code, 'unknown');
					`,
					[run.formatId, startTimestamp, endTimestamp, namedCodes, run.windowStart],
				);

				// 7b. 写入 stats_deck_top_players
				await queryRunner.query(
					`
					${commonCte},
					ranked_players AS (
						SELECT
							v.deck_type_code,
							v.user_id,
							u.username,
							COUNT(*)::int AS matches,
							COUNT(CASE WHEN v.winner = true THEN 1 END)::int AS wins,
							COUNT(CASE WHEN v.winner = false THEN 1 END)::int AS losses,
							(COUNT(CASE WHEN v.winner = true THEN 1 END)::float / COUNT(*)::float) AS win_rate,
							ROW_NUMBER() OVER (
								PARTITION BY v.deck_type_code
								ORDER BY (COUNT(CASE WHEN v.winner = true THEN 1 END)::float / COUNT(*)::float) DESC,
										 COUNT(*) DESC,
										 u.username ASC
							) AS rnk
						FROM valid_deck_perspectives v
						JOIN users u ON u.id = v.user_id
						GROUP BY v.deck_type_code, v.user_id, u.username
						HAVING COUNT(*) >= 25
					)
					INSERT INTO "stats_deck_top_players" (
						"format_id", "window_start", "deck_type_code", "rank",
						"user_id", "username", "matches", "wins", "losses", "win_rate"
					)
					SELECT
						$1,
						$5::date,
						r.deck_type_code,
						r.rnk::smallint,
						r.user_id,
						r.username,
						r.matches,
						r.wins,
						r.losses,
						r.win_rate
					FROM ranked_players r
					WHERE r.rnk <= 10;
					`,
					[run.formatId, startTimestamp, endTimestamp, namedCodes, run.windowStart],
				);
			}

			await queryRunner.commitTransaction();
		} catch (error) {
			await queryRunner.rollbackTransaction();
			throw error;
		} finally {
			await queryRunner.release();
		}
	}

	public async listRuns(formatId: string): Promise<UsageStatRunData[]> {
		return this.listPublishedRuns(formatId);
	}

	public async queryTopDecksUsage(
		formatId: string,
		windowStart: string,
	): Promise<{ deckTypeCode: string; deckCount: number }[]> {
		const rowsRes = await this.dataSource.query(
			`SELECT deck_type_code, deck_count
			 FROM "usage_deck_rows"
			 WHERE format_id = $1 AND window_start = $2::date
			 ORDER BY deck_count DESC, deck_type_code ASC`,
			[formatId, windowStart],
		);
		return (rowsRes ?? []).map((r: any) => ({
			deckTypeCode: r.deck_type_code,
			deckCount: Number(r.deck_count),
		}));
	}

	public async queryMatchupRows(
		formatId: string,
		windowStart: string,
	): Promise<DeckMatchupRowData[]> {
		const rowsRes = await this.dataSource.query(
			`SELECT format_id, window_start::text, first_deck_code, second_deck_code, match_count, first_wins
			 FROM "stats_deck_matchups"
			 WHERE format_id = $1 AND window_start = $2::date
			 ORDER BY first_deck_code ASC, second_deck_code ASC`,
			[formatId, windowStart],
		);
		return (rowsRes ?? []).map((r: any) => ({
			formatId: r.format_id,
			windowStart: r.window_start,
			firstDeckCode: r.first_deck_code,
			secondDeckCode: r.second_deck_code,
			matchCount: Number(r.match_count),
			firstWins: Number(r.first_wins),
		}));
	}

	public async queryDecks(
		formatId: string,
		windowStart: string,
		limit: number,
		offset: number,
	): Promise<{
		total: number;
		rows: { deckTypeCode: string; deckCount: number }[];
	}> {
		const countRes = await this.dataSource.query(
			`SELECT COUNT(*) AS total FROM "usage_deck_rows" WHERE format_id = $1 AND window_start = $2::date`,
			[formatId, windowStart],
		);
		const total = Number(countRes[0]?.total ?? 0);

		const rowsRes = await this.dataSource.query(
			`SELECT deck_type_code, deck_count
			 FROM "usage_deck_rows"
			 WHERE format_id = $1 AND window_start = $2::date
			 ORDER BY deck_count DESC, deck_type_code ASC
			 LIMIT $3 OFFSET $4`,
			[formatId, windowStart, limit, offset],
		);

		return {
			total,
			rows: (rowsRes ?? []).map((r: any) => ({
				deckTypeCode: r.deck_type_code,
				deckCount: Number(r.deck_count),
			})),
		};
	}

	public async queryCards(
		formatId: string,
		windowStart: string,
		metric: string,
		limit: number,
		offset: number,
	): Promise<{
		total: number;
		rows: {
			cardId: number;
			deckCount: number;
			copies1: number;
			copies2: number;
			copies3: number;
		}[];
	}> {
		const countRes = await this.dataSource.query(
			`SELECT COUNT(*) AS total FROM "usage_card_rows" WHERE format_id = $1 AND window_start = $2::date AND metric = $3`,
			[formatId, windowStart, metric],
		);
		const total = Number(countRes[0]?.total ?? 0);

		const rowsRes = await this.dataSource.query(
			`SELECT card_id, deck_count, copies_1, copies_2, copies_3
			 FROM "usage_card_rows"
			 WHERE format_id = $1 AND window_start = $2::date AND metric = $3
			 ORDER BY deck_count DESC, card_id ASC
			 LIMIT $4 OFFSET $5`,
			[formatId, windowStart, metric, limit, offset],
		);

		return {
			total,
			rows: (rowsRes ?? []).map((r: any) => ({
				cardId: Number(r.card_id),
				deckCount: Number(r.deck_count),
				copies1: Number(r.copies_1),
				copies2: Number(r.copies_2),
				copies3: Number(r.copies_3),
			})),
		};
	}

	public async querySnapshot(
		formatId: string,
		windowStart: string,
		metric: string,
		limit: number,
		offset: number,
	): Promise<UsageSnapshotData> {
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction("REPEATABLE READ");
		try {
			const runRows = await queryRunner.query(
				`
				SELECT 
					format_id,
					window_start::text,
					window_end_exclusive::text,
					data_end_exclusive::text,
					published_at,
					total_decks,
					side_known_decks
				FROM usage_stat_runs
				WHERE format_id = $1 AND window_start = $2::date;
			`,
				[formatId, windowStart],
			);

			if (!runRows || runRows.length === 0) {
				await queryRunner.commitTransaction();
				return { run: null, total: 0 };
			}

			const r = runRows[0];
			const run: UsageStatRunData = {
				formatId: r.format_id,
				windowStart: r.window_start,
				windowEndExclusive: r.window_end_exclusive,
				dataEndExclusive: r.data_end_exclusive,
				publishedAt: new Date(r.published_at),
				totalDecks: Number(r.total_decks),
				sideKnownDecks: Number(r.side_known_decks),
			};

			if (metric === "deck") {
				const countRes = await queryRunner.query(
					`
					SELECT COUNT(*) AS total
					FROM usage_deck_rows
					WHERE format_id = $1 AND window_start = $2::date;
				`,
					[formatId, windowStart],
				);
				const total = Number(countRes[0]?.total ?? 0);

				const rows = await queryRunner.query(
					`
					SELECT deck_type_code, deck_count
					FROM usage_deck_rows
					WHERE format_id = $1 AND window_start = $2::date
					ORDER BY deck_count DESC, deck_type_code ASC
					LIMIT $3 OFFSET $4;
				`,
					[formatId, windowStart, limit, offset],
				);

				await queryRunner.commitTransaction();
				return {
					run,
					total,
					deckRows: rows.map((x: any) => ({
						deckTypeCode: x.deck_type_code,
						deckCount: Number(x.deck_count),
					})),
				};
			}

			const countRes = await queryRunner.query(
				`
				SELECT COUNT(*) AS total
				FROM usage_card_rows
				WHERE format_id = $1 AND window_start = $2::date AND metric = $3;
			`,
				[formatId, windowStart, metric],
			);
			const total = Number(countRes[0]?.total ?? 0);

			const rows = await queryRunner.query(
				`
				SELECT card_id, deck_count, copies_1, copies_2, copies_3
				FROM usage_card_rows
				WHERE format_id = $1 AND window_start = $2::date AND metric = $3
				ORDER BY deck_count DESC, card_id ASC
				LIMIT $4 OFFSET $5;
			`,
				[formatId, windowStart, metric, limit, offset],
			);

			await queryRunner.commitTransaction();
			return {
				run,
				total,
				cardRows: rows.map((x: any) => ({
					cardId: Number(x.card_id),
					deckCount: Number(x.deck_count),
					copies1: Number(x.copies_1),
					copies2: Number(x.copies_2),
					copies3: Number(x.copies_3),
				})),
			};
		} catch (error) {
			if (queryRunner.isTransactionActive) {
				await queryRunner.rollbackTransaction();
			}
			throw error;
		} finally {
			await queryRunner.release();
		}
	}
}
