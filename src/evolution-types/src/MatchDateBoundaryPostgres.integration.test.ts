import { DataSource, QueryRunner } from "typeorm";
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
});
