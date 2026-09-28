import { DataSource, QueryRunner } from "typeorm";
import { UsageStatisticsRepository } from "../../application/RebuildUsageStatisticsUseCase";
import {
	UsageQueryRepository,
	UsageSnapshotData,
} from "../../application/GetUsageStatisticsUseCase";
import { UsageStatRunData, UsageDeckRowData } from "../../domain/UsageConsistencyValidator";
import { CardUsageRow } from "../../domain/CardUsageCalculator";
import { PlayerMatchDeckSnapshot } from "../../domain/DeckUsageCalculator";

export class UsageStatisticsPostgresRepository
	implements UsageStatisticsRepository, UsageQueryRepository
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

	public async *streamValidSnapshots(
		formatId: string,
		startInclusive: string,
		endExclusive: string,
		batchSize = 500,
	): AsyncIterable<PlayerMatchDeckSnapshot> {
		let cursorDate: string | null = null;
		let cursorId: string | null = null;

		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction("REPEATABLE READ");

		try {
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
					yield {
						matchId: row.match_id,
						formatId: row.format_id,
						deckTypeCode: row.deck_type_code ?? "",
						mainCards: row.main_cards ?? [],
						extraCards: row.extra_cards ?? [],
						sideCards: row.side_cards,
					};
				}

				if (rows.length < batchSize) {
					break;
				}

				const lastRow = rows[rows.length - 1];
				cursorDate = lastRow.date_str;
				cursorId = lastRow.match_id;
			}
			await queryRunner.commitTransaction();
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
		}[] = await this.dataSource.query(
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
		}[] = await this.dataSource.query(
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
		}));
	}

	public async publishPeriodStatistics(
		run: UsageStatRunData,
		deckRows: readonly UsageDeckRowData[],
		cardRows: readonly CardUsageRow[],
	): Promise<void> {
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			// 1. Delete details for this format and window
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
					"published_at", "total_decks", "side_known_decks"
				) VALUES ($1, $2::date, $3::date, $4::date, $5, $6, $7)
				ON CONFLICT ("format_id", "window_start") DO UPDATE SET
					"window_end_exclusive" = EXCLUDED."window_end_exclusive",
					"data_end_exclusive" = EXCLUDED."data_end_exclusive",
					"published_at" = EXCLUDED."published_at",
					"total_decks" = EXCLUDED."total_decks",
					"side_known_decks" = EXCLUDED."side_known_decks";
			`,
				[
					run.formatId,
					run.windowStart,
					run.windowEndExclusive,
					run.dataEndExclusive,
					run.publishedAt,
					run.totalDecks,
					run.sideKnownDecks,
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
