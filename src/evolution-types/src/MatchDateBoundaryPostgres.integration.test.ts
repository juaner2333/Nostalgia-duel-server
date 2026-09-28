import { DataSource, QueryRunner } from "typeorm";
import { HalfYearWindow } from "../../shared/stats/usage/domain/HalfYearWindow";
import { InitialRankedSchema1741000000000 } from "./migrations/1741000000000-InitialRankedSchema";
import { AddReplayDeckAccess1741000001000 } from "./migrations/1741000001000-AddReplayDeckAccess";

describe("MatchDateBoundary PostgreSQL Integration", () => {
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

	it("correctly handles Beijing midnight boundaries, half-year boundaries, and left-closed right-open queries", async () => {
		if (!isDbAvailable || !ds) {
			return;
		}
		const initialMigration = new InitialRankedSchema1741000000000();
		const deckMigration = new AddReplayDeckAccess1741000001000();
		const queryRunner = ds.createQueryRunner();

		try {
			// Ensure clean schema
			await queryRunner.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
			await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

			await initialMigration.up(queryRunner);
			await deckMigration.up(queryRunner);

			await queryRunner.query(`
				INSERT INTO "users" ("id", "username", "password", "email") VALUES
					('u-boundary-1', 'boundary1', 'hash', 'b1@test.com'),
					('u-boundary-2', 'boundary2', 'hash', 'b2@test.com')
				ON CONFLICT ("id") DO NOTHING;
			`);

			const sampleMatches = [
				{ id: "m-2025-12-31-night", date: "2025-12-31 23:59:59" },
				{ id: "m-2026-01-01-midnight", date: "2026-01-01 00:00:00" },
				{ id: "m-2026-01-01-noon", date: "2026-01-01 12:00:00" },
				{ id: "m-2026-06-30-night", date: "2026-06-30 23:59:59.999" },
				{ id: "m-2026-07-01-midnight", date: "2026-07-01 00:00:00" },
				{ id: "m-2026-09-26-night", date: "2026-09-26 23:59:59.999" },
				{ id: "m-2026-09-27-midnight", date: "2026-09-27 00:00:00" },
				{ id: "m-2026-12-31-night", date: "2026-12-31 23:59:59.999" },
				{ id: "m-2027-01-01-midnight", date: "2027-01-01 00:00:00" },
			];

			let idx = 0;
			for (const m of sampleMatches) {
				idx++;
				const testGameId = `b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b2${idx}`;
				await queryRunner.query(`
					INSERT INTO "matches" (
						"id", "user_id", "game_id", "format_id", "best_of", "player_names",
						"opponent_names", "date", "ban_list_name", "ban_list_hash",
						"player_score", "opponent_score", "winner", "season", "points"
					) VALUES (
						$1, 'u-boundary-1', '${testGameId}', '1109', 3, 'player1',
						'player2', $2::timestamp, '1109.0', 'hash', 2, 1, true, 1, 100
					) ON CONFLICT ("id") DO UPDATE SET "date" = $2::timestamp;
				`, [m.id, m.date]);
			}

			// Query 2026H1 [2026-01-01 00:00:00, 2026-07-01 00:00:00)
			const h1Rows: { id: string }[] = await queryRunner.query(`
				SELECT id FROM "matches"
				WHERE format_id = '1109'
				  AND date >= '2026-01-01 00:00:00'::timestamp
				  AND date < '2026-07-01 00:00:00'::timestamp
				  AND id LIKE 'm-202%'
				ORDER BY date ASC;
			`);
			const h1Ids = h1Rows.map((r) => r.id);
			expect(h1Ids).toEqual([
				"m-2026-01-01-midnight",
				"m-2026-01-01-noon",
				"m-2026-06-30-night",
			]);
			expect(h1Ids).not.toContain("m-2025-12-31-night");
			expect(h1Ids).not.toContain("m-2026-07-01-midnight");

			// Query 2026H2 [2026-07-01 00:00:00, 2027-01-01 00:00:00)
			const h2Rows: { id: string }[] = await queryRunner.query(`
				SELECT id FROM "matches"
				WHERE format_id = '1109'
				  AND date >= '2026-07-01 00:00:00'::timestamp
				  AND date < '2027-01-01 00:00:00'::timestamp
				  AND id LIKE 'm-202%'
				ORDER BY date ASC;
			`);
			const h2Ids = h2Rows.map((r) => r.id);
			expect(h2Ids).toEqual([
				"m-2026-07-01-midnight",
				"m-2026-09-26-night",
				"m-2026-09-27-midnight",
				"m-2026-12-31-night",
			]);
			expect(h2Ids).not.toContain("m-2026-06-30-night");
			expect(h2Ids).not.toContain("m-2027-01-01-midnight");

			// Query daily cutoff for 2026H2 on 2026-09-27: [2026-07-01 00:00:00, 2026-09-27 00:00:00)
			const dailyCutoffRows: { id: string }[] = await queryRunner.query(`
				SELECT id FROM "matches"
				WHERE format_id = '1109'
				  AND date >= '2026-07-01 00:00:00'::timestamp
				  AND date < '2026-09-27 00:00:00'::timestamp
				  AND id LIKE 'm-202%'
				ORDER BY date ASC;
			`);
			const dailyCutoffIds = dailyCutoffRows.map((r) => r.id);
			expect(dailyCutoffIds).toEqual([
				"m-2026-07-01-midnight",
				"m-2026-09-26-night",
			]);
			expect(dailyCutoffIds).not.toContain("m-2026-09-27-midnight");

			// Read-back verification: date format as timestamp string and Date object
			const midnightRow: { date: Date; date_str: string }[] = await queryRunner.query(`
				SELECT date, to_char(date, 'YYYY-MM-DD HH24:MI:SS') as date_str
				FROM "matches"
				WHERE id = 'm-2026-01-01-midnight';
			`);
			expect(midnightRow).toHaveLength(1);
			expect(midnightRow[0].date_str).toBe("2026-01-01 00:00:00");
		} finally {
			await queryRunner.release();
		}
	});

	it("verifies matches.date read/write semantics across Beijing half-year transitions, task 00:00 cutoff, and matches.season cross-checks using HalfYearWindow", async () => {
		if (!isDbAvailable || !ds) {
			return;
		}
		const initialMigration = new InitialRankedSchema1741000000000();
		const deckMigration = new AddReplayDeckAccess1741000001000();
		const queryRunner = ds.createQueryRunner();

		try {
			await queryRunner.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
			await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

			await initialMigration.up(queryRunner);
			await deckMigration.up(queryRunner);

			await queryRunner.query(`
				INSERT INTO "users" ("id", "username", "password", "email") VALUES
					('u-boundary-cross-1', 'cross1', 'hash', 'cross1@test.com')
				ON CONFLICT ("id") DO NOTHING;
			`);

			const crossMatches = [
				{ id: "m-cross-2025-12-31-night", date: "2025-12-31 23:59:59.999", season: 202512 },
				{ id: "m-cross-2026-01-01-midnight", date: "2026-01-01 00:00:00", season: 202601 },
				{ id: "m-cross-2026-06-30-night", date: "2026-06-30 23:59:59.999", season: 202606 },
				{ id: "m-cross-2026-07-01-midnight", date: "2026-07-01 00:00:00", season: 202607 },
				{ id: "m-cross-2026-09-27-night", date: "2026-09-27 23:59:59.999", season: 202609 },
				{ id: "m-cross-2026-09-28-midnight", date: "2026-09-28 00:00:00", season: 202609 },
				{ id: "m-cross-2026-12-31-night", date: "2026-12-31 23:59:59.999", season: 202612 },
				{ id: "m-cross-2027-01-01-midnight", date: "2027-01-01 00:00:00", season: 202701 },
			];

			let idx = 0;
			for (const m of crossMatches) {
				idx++;
				const testGameId = `c0eebc99-9c0b-4ef8-bb6d-6bb9bd380b2${idx}`;
				await queryRunner.query(
					`
					INSERT INTO "matches" (
						"id", "user_id", "game_id", "format_id", "best_of", "player_names",
						"opponent_names", "date", "ban_list_name", "ban_list_hash",
						"player_score", "opponent_score", "winner", "season", "points"
					) VALUES (
						$1, 'u-boundary-cross-1', '${testGameId}', '1109', 3, 'player1',
						'player2', $2::timestamp, '1109.0', 'hash', 2, 1, true, $3, 100
					);
				`,
					[m.id, m.date, m.season],
				);
			}

			// 1. Verify finalized 2026H1 using HalfYearWindow.fromPeriodString("2026H1", "2026-09-28")
			const h1Window = HalfYearWindow.fromPeriodString("2026H1", "2026-09-28");
			expect(h1Window.windowStart).toBe("2026-01-01");
			expect(h1Window.windowEndExclusive).toBe("2026-07-01");
			expect(h1Window.dataEndExclusive).toBe("2026-07-01");

			const h1Rows: { id: string; season: number; date: Date }[] = await queryRunner.query(
				`
				SELECT id, season, date FROM "matches"
				WHERE format_id = '1109'
				  AND date >= $1::timestamp
				  AND date < $2::timestamp
				ORDER BY date ASC;
			`,
				[h1Window.windowStart, h1Window.dataEndExclusive],
			);
			expect(h1Rows.map((r) => r.id)).toEqual([
				"m-cross-2026-01-01-midnight",
				"m-cross-2026-06-30-night",
			]);
			// Cross-verify all H1 rows fall into season 202601..202606
			for (const r of h1Rows) {
				expect(r.season).toBeGreaterThanOrEqual(202601);
				expect(r.season).toBeLessThanOrEqual(202606);
			}

			// Cross-verify query by season matches query by date range
			const h1BySeasonRows: { id: string }[] = await queryRunner.query(
				`
				SELECT id FROM "matches"
				WHERE format_id = '1109'
				  AND season BETWEEN 202601 AND 202606
				ORDER BY date ASC;
			`,
			);
			expect(h1BySeasonRows.map((r) => r.id)).toEqual(h1Rows.map((r) => r.id));

			// 2. Verify ongoing 2026H2 on task run day 2026-09-28 using HalfYearWindow.current("2026-09-28")
			const h2OngoingWindow = HalfYearWindow.current("2026-09-28");
			expect(h2OngoingWindow.period).toBe("2026H2");
			expect(h2OngoingWindow.windowStart).toBe("2026-07-01");
			expect(h2OngoingWindow.windowEndExclusive).toBe("2027-01-01");
			expect(h2OngoingWindow.dataEndExclusive).toBe("2026-09-28");

			const h2OngoingRows: { id: string; season: number }[] = await queryRunner.query(
				`
				SELECT id, season FROM "matches"
				WHERE format_id = '1109'
				  AND date >= $1::timestamp
				  AND date < $2::timestamp
				ORDER BY date ASC;
			`,
				[h2OngoingWindow.windowStart, h2OngoingWindow.dataEndExclusive],
			);
			expect(h2OngoingRows.map((r) => r.id)).toEqual([
				"m-cross-2026-07-01-midnight",
				"m-cross-2026-09-27-night",
			]);
			// Excludes 2026-09-28 00:00:00 cutoff despite matching monthly season
			expect(h2OngoingRows.map((r) => r.id)).not.toContain("m-cross-2026-09-28-midnight");
			for (const r of h2OngoingRows) {
				expect(r.season).toBeGreaterThanOrEqual(202607);
				expect(r.season).toBeLessThanOrEqual(202612);
			}

			// 3. Verify half-year switch when task runs at 2027-01-01 03:00 (reference date 2027-01-01)
			const prevOf2027H1 = HalfYearWindow.previousOf("2027H1");
			expect(prevOf2027H1.period).toBe("2026H2");
			expect(prevOf2027H1.windowStart).toBe("2026-07-01");
			expect(prevOf2027H1.dataEndExclusive).toBe("2027-01-01");

			const finalizedH2Rows: { id: string; season: number }[] = await queryRunner.query(
				`
				SELECT id, season FROM "matches"
				WHERE format_id = '1109'
				  AND date >= $1::timestamp
				  AND date < $2::timestamp
				ORDER BY date ASC;
			`,
				[prevOf2027H1.windowStart, prevOf2027H1.dataEndExclusive],
			);
			expect(finalizedH2Rows.map((r) => r.id)).toEqual([
				"m-cross-2026-07-01-midnight",
				"m-cross-2026-09-27-night",
				"m-cross-2026-09-28-midnight",
				"m-cross-2026-12-31-night",
			]);
			expect(finalizedH2Rows.map((r) => r.id)).not.toContain("m-cross-2027-01-01-midnight");
			for (const r of finalizedH2Rows) {
				expect(r.season).toBeGreaterThanOrEqual(202607);
				expect(r.season).toBeLessThanOrEqual(202612);
			}

			// 4. Verify 2027H1 current window on 2027-01-01 (start date = dataEndExclusive, empty slice)
			const newYearH1 = HalfYearWindow.current("2027-01-01");
			expect(newYearH1.period).toBe("2027H1");
			expect(newYearH1.windowStart).toBe("2027-01-01");
			expect(newYearH1.dataEndExclusive).toBe("2027-01-01");

			const emptyH1Rows: { id: string }[] = await queryRunner.query(
				`
				SELECT id FROM "matches"
				WHERE format_id = '1109'
				  AND date >= $1::timestamp
				  AND date < $2::timestamp;
			`,
				[newYearH1.windowStart, newYearH1.dataEndExclusive],
			);
			expect(emptyH1Rows).toHaveLength(0);
		} finally {
			await queryRunner.release();
		}
	});
});
