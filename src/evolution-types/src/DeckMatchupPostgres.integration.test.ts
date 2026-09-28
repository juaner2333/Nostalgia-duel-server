import { DataSource, QueryRunner } from "typeorm";
import { InitialRankedSchema1741000000000 } from "./migrations/1741000000000-InitialRankedSchema";
import { AddReplayDeckAccess1741000001000 } from "./migrations/1741000001000-AddReplayDeckAccess";
import { AddHalfYearUsageStatistics1741000002000 } from "./migrations/1741000002000-AddHalfYearUsageStatistics";
import { AddHalfYearDeckMatchups1741000003000 } from "./migrations/1741000003000-AddHalfYearDeckMatchups";

describe("DeckMatchup PostgreSQL Integration", () => {
	let ds: DataSource | undefined;
	let suiteLockRunner: QueryRunner | undefined;
	let isDbAvailable = false;

	beforeAll(async () => {
		try {
			ds = new DataSource({
				type: "postgres",
				host: process.env.POSTGRES_TEST_HOST ?? process.env.POSTGRES_HOST ?? "127.0.0.1",
				port: process.env.POSTGRES_TEST_PORT
					? Number(process.env.POSTGRES_TEST_PORT)
					: process.env.POSTGRES_PORT
						? Number(process.env.POSTGRES_PORT)
						: 5432,
				username:
					process.env.POSTGRES_TEST_USER ?? process.env.POSTGRES_USER ?? "evolution",
				password:
					process.env.POSTGRES_TEST_PASSWORD ??
					process.env.POSTGRES_PASSWORD ??
					"your-postgres-password",
				database:
					process.env.POSTGRES_TEST_DB ?? process.env.POSTGRES_DB ?? "evolution",
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

	it("runs AddHalfYearDeckMatchups migration, enforces constraints, checks indices, and rolls back cleanly", async () => {
		if (!isDbAvailable || !ds) {
			return;
		}
		const initialMigration = new InitialRankedSchema1741000000000();
		const replayDeckMigration = new AddReplayDeckAccess1741000001000();
		const usageMigration = new AddHalfYearUsageStatistics1741000002000();
		const matchupMigration = new AddHalfYearDeckMatchups1741000003000();
		const queryRunner = ds.createQueryRunner();

		try {
			await queryRunner.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
			await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

			await initialMigration.up(queryRunner);
			await replayDeckMigration.up(queryRunner);
			await usageMigration.up(queryRunner);
			await matchupMigration.up(queryRunner);

			// Seed a test user, match, and replay
			await queryRunner.query(`
				INSERT INTO "users" ("id", "username", "password", "email") VALUES
					('u-matchup-1', 'matchup1', 'hash', 'm1@test.com'),
					('u-matchup-2', 'matchup2', 'hash', 'm2@test.com');
			`);

			const testGameId = "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380b20";
			await queryRunner.query(`
				INSERT INTO "matches" (
					"id", "user_id", "game_id", "format_id", "best_of", "player_names",
					"opponent_names", "date", "ban_list_name", "ban_list_hash",
					"player_score", "opponent_score", "winner", "season", "points"
				) VALUES (
					'm-test-1', 'u-matchup-1', '${testGameId}', '1109', 3, 'player1',
					'player2', '2026-08-01 10:00:00'::timestamp, '1109.0', 'hash', 2, 1, true, 202608, 100
				);
			`);

			// 1. Verify duels constraint ck_duels_matchup_duel_index: 1..3 valid, 0 or 4 invalid
			await expect(
				queryRunner.query(`
					INSERT INTO "duels" (
						"id", "user_id", "game_id", "replay_id", "player_names",
						"opponent_names", "date", "ban_list_name", "ban_list_hash",
						"result", "turns", "match_id", "season", "duel_index", "is_first"
					) VALUES (
						'd-invalid-index', 'u-matchup-1', '${testGameId}', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b21',
						'p1', 'p2', '2026-08-01 10:00:00'::timestamp, '1109.0', 'hash',
						'win', 5, 'm-test-1', 202608, 4, true
					);
				`),
			).rejects.toThrow();

			// 2. Verify duels constraint ck_duels_matchup_first_requires_index: is_first without duel_index invalid
			await expect(
				queryRunner.query(`
					INSERT INTO "duels" (
						"id", "user_id", "game_id", "replay_id", "player_names",
						"opponent_names", "date", "ban_list_name", "ban_list_hash",
						"result", "turns", "match_id", "season", "duel_index", "is_first"
					) VALUES (
						'd-invalid-first', 'u-matchup-1', '${testGameId}', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22',
						'p1', 'p2', '2026-08-01 10:00:00'::timestamp, '1109.0', 'hash',
						'win', 5, 'm-test-1', 202608, NULL, true
					);
				`),
			).rejects.toThrow();

			// 3. Valid duel insert with duel_index = 1, is_first = true
			await queryRunner.query(`
				INSERT INTO "duels" (
					"id", "user_id", "game_id", "replay_id", "player_names",
					"opponent_names", "date", "ban_list_name", "ban_list_hash",
					"result", "turns", "match_id", "season", "duel_index", "is_first"
				) VALUES (
					'd-valid-1', 'u-matchup-1', '${testGameId}', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b23',
					'p1', 'p2', '2026-08-01 10:00:00'::timestamp, '1109.0', 'hash',
					'win', 5, 'm-test-1', 202608, 1, true
				);
			`);

			// 4. Unique index uq_duels_active_match_duel_index: second active duel with same match_id and duel_index fails
			await expect(
				queryRunner.query(`
					INSERT INTO "duels" (
						"id", "user_id", "game_id", "replay_id", "player_names",
						"opponent_names", "date", "ban_list_name", "ban_list_hash",
						"result", "turns", "match_id", "season", "duel_index", "is_first"
					) VALUES (
						'd-duplicate-index', 'u-matchup-1', '${testGameId}', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b24',
						'p1', 'p2', '2026-08-01 10:00:00'::timestamp, '1109.0', 'hash',
						'win', 5, 'm-test-1', 202608, 1, false
					);
				`),
			).rejects.toThrow();

			// 5. Seed usage_stat_runs for foreign key tests
			await queryRunner.query(`
				INSERT INTO "usage_stat_runs" (
					"format_id", "window_start", "window_end_exclusive", "data_end_exclusive",
					"published_at", "total_decks", "side_known_decks"
				) VALUES (
					'1109', '2026-07-01', '2027-01-01', '2026-09-28',
					NOW(), 100, 90
				);
			`);

			// 6. Verify stats_deck_matchups check constraint ck_stats_deck_matchups_format (only 1109)
			await expect(
				queryRunner.query(`
					INSERT INTO "stats_deck_matchups" (
						"format_id", "window_start", "first_deck_code", "second_deck_code", "match_count", "first_wins"
					) VALUES (
						'1103', '2026-07-01', 'D01', 'D02', 10, 6
					);
				`),
			).rejects.toThrow();

			// 7. Verify stats_deck_matchups check constraint ck_stats_deck_matchups_named_only (no OTHERS)
			await expect(
				queryRunner.query(`
					INSERT INTO "stats_deck_matchups" (
						"format_id", "window_start", "first_deck_code", "second_deck_code", "match_count", "first_wins"
					) VALUES (
						'1109', '2026-07-01', 'OTHERS', 'D02', 10, 6
					);
				`),
			).rejects.toThrow();

			// 8. Verify stats_deck_matchups check constraint ck_stats_deck_matchups_counts (match_count > 0, 0 <= first_wins <= match_count)
			await expect(
				queryRunner.query(`
					INSERT INTO "stats_deck_matchups" (
						"format_id", "window_start", "first_deck_code", "second_deck_code", "match_count", "first_wins"
					) VALUES (
						'1109', '2026-07-01', 'D01', 'D02', 0, 0
					);
				`),
			).rejects.toThrow();

			await expect(
				queryRunner.query(`
					INSERT INTO "stats_deck_matchups" (
						"format_id", "window_start", "first_deck_code", "second_deck_code", "match_count", "first_wins"
					) VALUES (
						'1109', '2026-07-01', 'D01', 'D02', 10, 11
					);
				`),
			).rejects.toThrow();

			// 9. Verify foreign keys: invalid first_deck_code fails
			await expect(
				queryRunner.query(`
					INSERT INTO "stats_deck_matchups" (
						"format_id", "window_start", "first_deck_code", "second_deck_code", "match_count", "first_wins"
					) VALUES (
						'1109', '2026-07-01', 'NONEXISTENT', 'D02', 10, 6
					);
				`),
			).rejects.toThrow();

			// 10. Valid stats_deck_matchups insert
			await queryRunner.query(`
				INSERT INTO "stats_deck_matchups" (
					"format_id", "window_start", "first_deck_code", "second_deck_code", "match_count", "first_wins"
				) VALUES (
					'1109', '2026-07-01', 'D01', 'D02', 10, 6
				);
			`);

			const matchupRows: { match_count: string; first_wins: string }[] = await queryRunner.query(`
				SELECT match_count, first_wins FROM "stats_deck_matchups"
				WHERE format_id = '1109' AND window_start = '2026-07-01'
				  AND first_deck_code = 'D01' AND second_deck_code = 'D02';
			`);
			expect(matchupRows).toHaveLength(1);
			expect(Number(matchupRows[0].match_count)).toBe(10);
			expect(Number(matchupRows[0].first_wins)).toBe(6);

			// 11. Roll back migration and verify clean teardown
			await matchupMigration.down(queryRunner);

			const tableCheck: unknown[] = await queryRunner.query(`
				SELECT table_name FROM information_schema.tables
				WHERE table_schema = 'public' AND table_name = 'stats_deck_matchups';
			`);
			expect(tableCheck).toHaveLength(0);

			const duelsColCheck: { column_name: string }[] = await queryRunner.query(`
				SELECT column_name FROM information_schema.columns
				WHERE table_name = 'duels' AND column_name IN ('duel_index', 'is_first');
			`);
			expect(duelsColCheck).toHaveLength(0);
		} finally {
			await queryRunner.release();
		}
	});
});
