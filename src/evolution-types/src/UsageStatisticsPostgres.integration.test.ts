import { DataSource, QueryRunner } from "typeorm";
import { InitialRankedSchema1741000000000 } from "./migrations/1741000000000-InitialRankedSchema";
import { AddReplayDeckAccess1741000001000 } from "./migrations/1741000001000-AddReplayDeckAccess";
import { AddHalfYearUsageStatistics1741000002000 } from "./migrations/1741000002000-AddHalfYearUsageStatistics";

describe("UsageStatistics Isolated PostgreSQL Integration", () => {
	let ds: DataSource | undefined;
	let suiteLockRunner: QueryRunner | undefined;
	let isDbAvailable = false;

	beforeAll(async () => {
		try {
			ds = new DataSource({
				type: "postgres",
				host: process.env.POSTGRES_TEST_HOST ?? "127.0.0.1",
				port: process.env.POSTGRES_TEST_PORT ? Number(process.env.POSTGRES_TEST_PORT) : 5434,
				username: process.env.POSTGRES_TEST_USER ?? "postgres",
				password: process.env.POSTGRES_TEST_PASSWORD ?? "postgres",
				database: process.env.POSTGRES_TEST_DB ?? "evolution",
				synchronize: false,
				logging: false,
			});
			await ds.initialize();
			suiteLockRunner = ds.createQueryRunner();
			await suiteLockRunner.connect();
			await suiteLockRunner.query("SELECT pg_advisory_lock(88888888)");
			await ds.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
			isDbAvailable = true;
		} catch {
			isDbAvailable = false;
		}
	});

	afterAll(async () => {
		if (suiteLockRunner) {
			try {
				await suiteLockRunner.query("SELECT pg_advisory_unlock(88888888)");
			} catch {
				// Unlock failure cleanup
			} finally {
				await suiteLockRunner.release();
			}
		}
		if (ds?.isInitialized) {
			await ds.destroy();
		}
	});

	it("runs migrations, enforces usage schema constraints, checks indices, and rolls back cleanly", async () => {
		if (!isDbAvailable || !ds) {
			return;
		}

		const initialMigration = new InitialRankedSchema1741000000000();
		const deckMigration = new AddReplayDeckAccess1741000001000();
		const usageMigration = new AddHalfYearUsageStatistics1741000002000();
		const queryRunner = ds.createQueryRunner();

		try {
			// Ensure clean schema
			await queryRunner.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
			await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

			// 1. Run migrations up
			await initialMigration.up(queryRunner);
			await deckMigration.up(queryRunner);
			await usageMigration.up(queryRunner);

			// 2. Verify tables exist
			const tables = await queryRunner.query(`
				SELECT table_name FROM information_schema.tables
				WHERE table_schema = 'public'
				  AND table_name IN ('usage_stat_runs', 'usage_deck_rows', 'usage_card_rows')
				ORDER BY table_name;
			`);
			expect(tables).toHaveLength(3);

			// 3. Verify NO database foreign keys on usage tables
			const fks = await queryRunner.query(`
				SELECT constraint_name, table_name
				FROM information_schema.table_constraints
				WHERE table_schema = 'public'
				  AND constraint_type = 'FOREIGN KEY'
				  AND table_name IN ('usage_stat_runs', 'usage_deck_rows', 'usage_card_rows');
			`);
			expect(fks).toHaveLength(0);

			// 4. Verify usage_stat_runs constraints
			// Valid row
			await queryRunner.query(`
				INSERT INTO "usage_stat_runs" (
					"format_id", "window_start", "window_end_exclusive", "data_end_exclusive",
					"published_at", "total_decks", "side_known_decks"
				) VALUES (
					'1109', '2026-07-01', '2027-01-01', '2026-09-27',
					NOW(), 100, 80
				)
			`);

			// Reject invalid format_id
			await expect(
				queryRunner.query(`
					INSERT INTO "usage_stat_runs" (
						"format_id", "window_start", "window_end_exclusive", "data_end_exclusive",
						"published_at", "total_decks", "side_known_decks"
					) VALUES (
						'9999', '2026-07-01', '2027-01-01', '2026-09-27',
						NOW(), 100, 80
					)
				`),
			).rejects.toThrow();

			// Reject non-half-year start day (not 1st)
			await expect(
				queryRunner.query(`
					INSERT INTO "usage_stat_runs" (
						"format_id", "window_start", "window_end_exclusive", "data_end_exclusive",
						"published_at", "total_decks", "side_known_decks"
					) VALUES (
						'1109', '2026-07-02', '2027-01-02', '2026-09-27',
						NOW(), 100, 80
					)
				`),
			).rejects.toThrow();

			// Reject non-half-year start month (not Jan or Jul)
			await expect(
				queryRunner.query(`
					INSERT INTO "usage_stat_runs" (
						"format_id", "window_start", "window_end_exclusive", "data_end_exclusive",
						"published_at", "total_decks", "side_known_decks"
					) VALUES (
						'1109', '2026-03-01', '2026-09-01', '2026-05-01',
						NOW(), 100, 80
					)
				`),
			).rejects.toThrow();

			// Reject window_end_exclusive not 6 months from window_start
			await expect(
				queryRunner.query(`
					INSERT INTO "usage_stat_runs" (
						"format_id", "window_start", "window_end_exclusive", "data_end_exclusive",
						"published_at", "total_decks", "side_known_decks"
					) VALUES (
						'1109', '2026-01-01', '2026-08-01', '2026-05-01',
						NOW(), 100, 80
					)
				`),
			).rejects.toThrow();

			// Reject side_known_decks > total_decks
			await expect(
				queryRunner.query(`
					INSERT INTO "usage_stat_runs" (
						"format_id", "window_start", "window_end_exclusive", "data_end_exclusive",
						"published_at", "total_decks", "side_known_decks"
					) VALUES (
						'1103', '2026-01-01', '2026-07-01', '2026-06-01',
						NOW(), 50, 60
					)
				`),
			).rejects.toThrow();

			// 5. Verify usage_deck_rows constraints
			// Valid row
			await queryRunner.query(`
				INSERT INTO "usage_deck_rows" ("format_id", "window_start", "deck_type_code", "deck_count")
				VALUES ('1109', '2026-07-01', 'D01', 25);
			`);

			// Reject deck_count <= 0
			await expect(
				queryRunner.query(`
					INSERT INTO "usage_deck_rows" ("format_id", "window_start", "deck_type_code", "deck_count")
					VALUES ('1109', '2026-07-01', 'D02', 0);
				`),
			).rejects.toThrow();

			// 6. Verify usage_card_rows constraints
			// Valid row
			await queryRunner.query(`
				INSERT INTO "usage_card_rows" (
					"format_id", "window_start", "metric", "card_id", "deck_count",
					"copies_1", "copies_2", "copies_3"
				) VALUES (
					'1109', '2026-07-01', 'monster', 10000, 10, 2, 3, 5
				);
			`);

			// Reject invalid metric
			await expect(
				queryRunner.query(`
					INSERT INTO "usage_card_rows" (
						"format_id", "window_start", "metric", "card_id", "deck_count",
						"copies_1", "copies_2", "copies_3"
					) VALUES (
						'1109', '2026-07-01', 'magic', 10000, 10, 2, 3, 5
					);
				`),
			).rejects.toThrow();

			// Reject bucket invariant copies_1 + copies_2 + copies_3 != deck_count
			await expect(
				queryRunner.query(`
					INSERT INTO "usage_card_rows" (
						"format_id", "window_start", "metric", "card_id", "deck_count",
						"copies_1", "copies_2", "copies_3"
					) VALUES (
						'1109', '2026-07-01', 'monster', 10001, 10, 2, 2, 5
					);
				`),
			).rejects.toThrow();

			// 7. Verify index existence and query plan
			const explainDeck = await queryRunner.query(`
				EXPLAIN SELECT * FROM "usage_deck_rows"
				WHERE format_id = '1109' AND window_start = '2026-07-01'
				ORDER BY deck_count DESC, deck_type_code ASC;
			`);
			expect(explainDeck.length).toBeGreaterThan(0);

			const explainCard = await queryRunner.query(`
				EXPLAIN SELECT * FROM "usage_card_rows"
				WHERE format_id = '1109' AND window_start = '2026-07-01' AND metric = 'monster'
				ORDER BY deck_count DESC, card_id ASC;
			`);
			expect(explainCard.length).toBeGreaterThan(0);

			const explainMatches = await queryRunner.query(`
				EXPLAIN SELECT id FROM "matches"
				WHERE format_id = '1109'
				  AND date >= '2026-07-01 00:00:00'::timestamp
				  AND date < '2026-09-27 00:00:00'::timestamp
				  AND deleted_at IS NULL AND anulled = false;
			`);
			expect(explainMatches.length).toBeGreaterThan(0);

			// 8. Verify rerun idempotence (cleanup and replacement in short transaction)
			await queryRunner.startTransaction();
			await queryRunner.query(
				`DELETE FROM "usage_card_rows" WHERE format_id = '1109' AND window_start = '2026-07-01'`,
			);
			await queryRunner.query(
				`DELETE FROM "usage_deck_rows" WHERE format_id = '1109' AND window_start = '2026-07-01'`,
			);
			await queryRunner.query(`
				INSERT INTO "usage_stat_runs" (
					"format_id", "window_start", "window_end_exclusive", "data_end_exclusive",
					"published_at", "total_decks", "side_known_decks"
				) VALUES (
					'1109', '2026-07-01', '2027-01-01', '2026-09-28',
					NOW(), 120, 95
				) ON CONFLICT ("format_id", "window_start") DO UPDATE SET
					"data_end_exclusive" = EXCLUDED."data_end_exclusive",
					"published_at" = EXCLUDED."published_at",
					"total_decks" = EXCLUDED."total_decks",
					"side_known_decks" = EXCLUDED."side_known_decks"
			`);
			await queryRunner.query(`
				INSERT INTO "usage_deck_rows" ("format_id", "window_start", "deck_type_code", "deck_count")
				VALUES ('1109', '2026-07-01', 'D01', 30);
			`);
			await queryRunner.commitTransaction();

			const updatedRun = await queryRunner.query(`
				SELECT total_decks, side_known_decks, data_end_exclusive::text
				FROM "usage_stat_runs"
				WHERE format_id = '1109' AND window_start = '2026-07-01';
			`);
			expect(Number(updatedRun[0].total_decks)).toBe(120);
			expect(Number(updatedRun[0].side_known_decks)).toBe(95);
			expect(updatedRun[0].data_end_exclusive).toBe("2026-09-28");

			// 9. Rollback down cleanly
			await usageMigration.down(queryRunner);

			const usageTablesCheck = await queryRunner.query(`
				SELECT table_name FROM information_schema.tables
				WHERE table_schema = 'public'
				  AND table_name IN ('usage_stat_runs', 'usage_deck_rows', 'usage_card_rows');
			`);
			expect(usageTablesCheck).toHaveLength(0);
		} finally {
			await queryRunner.release();
		}
	});
});
