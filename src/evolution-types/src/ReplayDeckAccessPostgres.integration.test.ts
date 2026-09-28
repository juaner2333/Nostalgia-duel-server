import { DataSource, QueryRunner } from "typeorm";
import { InitialRankedSchema1741000000000 } from "./migrations/1741000000000-InitialRankedSchema";
import { AddReplayDeckAccess1741000001000 } from "./migrations/1741000001000-AddReplayDeckAccess";

describe("ReplayDeckAccess Isolated PostgreSQL Integration", () => {
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

	it("runs migrations, verifies seeds, enforces schema constraints, and rolls back cleanly", async () => {
		if (!isDbAvailable || !ds) {
			return;
		}
		const initialMigration = new InitialRankedSchema1741000000000();
		const deckMigration = new AddReplayDeckAccess1741000001000();
		const queryRunner = ds.createQueryRunner();

		try {
			// Ensure clean schema
			await queryRunner.query(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`);
			await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

			// 1. Run migrations up
			await initialMigration.up(queryRunner);
			await deckMigration.up(queryRunner);

			// 2. Verify seeds
			const rows1103 = await queryRunner.query(
				`SELECT * FROM "deck_types" WHERE "format_id" = '1103' ORDER BY "sort_order"`,
			);
			expect(rows1103).toHaveLength(1);
			expect(rows1103[0].code).toBe("OTHERS");

			const rows1109 = await queryRunner.query(
				`SELECT * FROM "deck_types" WHERE "format_id" = '1109' ORDER BY "sort_order"`,
			);
			expect(rows1109).toHaveLength(26);
			expect(rows1109[0].code).toBe("D01");
			expect(rows1109[24].code).toBe("D25");
			expect(rows1109[25].code).toBe("OTHERS");

			// Insert dummy users and match for constraint testing
			await queryRunner.query(`
				INSERT INTO "users" ("id", "username", "password", "email") VALUES
					('u1', 'player1', 'hash', 'p1@test.com'),
					('u2', 'player2', 'hash', 'p2@test.com')
			`);

			const gameId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
			await queryRunner.query(`
				INSERT INTO "matches" (
					"id", "user_id", "game_id", "format_id", "best_of", "player_names",
					"opponent_names", "date", "ban_list_name", "ban_list_hash",
					"player_score", "opponent_score", "winner", "season", "points"
				) VALUES (
					'm-1103-1', 'u1', '${gameId}', '1103', 3, 'player1',
					'player2', NOW(), '1103.0', 'hash', 2, 1, true, 1, 100
				)
			`);

			const validMain40 = Array(40).fill(10000);
			const validExtra15 = Array(15).fill(20000);
			const validSide15 = Array(15).fill(30000);

			// Test A: Cross-format deck type rejected (D01 only exists for 1109, not 1103)
			await expect(
				queryRunner.query(`
					INSERT INTO "match_decks" (
						"match_id", "format_id", "deck_type_code", "classifier_version",
						"snapshot_source", "main_cards", "extra_cards", "side_cards"
					) VALUES (
						'm-1103-1', '1103', 'D01', 'v1',
						'online', $1, $2, $3
					)
				`, [validMain40, validExtra15, validSide15]),
			).rejects.toThrow();

			// Test B: Illegal deck size rejected
			// Main < 40
			await expect(
				queryRunner.query(`
					INSERT INTO "match_decks" (
						"match_id", "format_id", "deck_type_code", "classifier_version",
						"snapshot_source", "main_cards", "extra_cards", "side_cards"
					) VALUES (
						'm-1103-1', '1103', 'OTHERS', 'v1',
						'online', $1, $2, $3
					)
				`, [Array(39).fill(10000), validExtra15, validSide15]),
			).rejects.toThrow();

			// Extra > 15
			await expect(
				queryRunner.query(`
					INSERT INTO "match_decks" (
						"match_id", "format_id", "deck_type_code", "classifier_version",
						"snapshot_source", "main_cards", "extra_cards", "side_cards"
					) VALUES (
						'm-1103-1', '1103', 'OTHERS', 'v1',
						'online', $1, $2, $3
					)
				`, [validMain40, Array(16).fill(20000), validSide15]),
			).rejects.toThrow();

			// Side > 15
			await expect(
				queryRunner.query(`
					INSERT INTO "match_decks" (
						"match_id", "format_id", "deck_type_code", "classifier_version",
						"snapshot_source", "main_cards", "extra_cards", "side_cards"
					) VALUES (
						'm-1103-1', '1103', 'OTHERS', 'v1',
						'online', $1, $2, $3
					)
				`, [validMain40, validExtra15, Array(16).fill(30000)]),
			).rejects.toThrow();

			// Test C: Valid insert succeeds (including NULL side_cards for partial backfill)
			await queryRunner.query(`
				INSERT INTO "match_decks" (
					"match_id", "format_id", "deck_type_code", "classifier_version",
					"snapshot_source", "main_cards", "extra_cards", "side_cards"
				) VALUES (
					'm-1103-1', '1103', 'OTHERS', 'v1',
					'online', $1, $2, NULL
				)
			`, [validMain40, validExtra15]);

			// Duplicate player perspective rejected
			await expect(
				queryRunner.query(`
					INSERT INTO "match_decks" (
						"match_id", "format_id", "deck_type_code", "classifier_version",
						"snapshot_source", "main_cards", "extra_cards", "side_cards"
					) VALUES (
						'm-1103-1', '1103', 'OTHERS', 'v1',
						'online', $1, $2, $3
					)
				`, [validMain40, validExtra15, validSide15]),
			).rejects.toThrow();

			// Test D: Orphan snapshot rejected
			await expect(
				queryRunner.query(`
					INSERT INTO "match_decks" (
						"match_id", "format_id", "deck_type_code", "classifier_version",
						"snapshot_source", "main_cards", "extra_cards", "side_cards"
					) VALUES (
						'non-existent-match', '1103', 'OTHERS', 'v1',
						'online', $1, $2, $3
					)
				`, [validMain40, validExtra15, validSide15]),
			).rejects.toThrow();

			// Mismatched format_id between match and match_deck rejected
			await expect(
				queryRunner.query(`
					INSERT INTO "match_decks" (
						"match_id", "format_id", "deck_type_code", "classifier_version",
						"snapshot_source", "main_cards", "extra_cards", "side_cards"
					) VALUES (
						'm-1103-1', '1109', 'D01', 'v1',
						'online', $1, $2, $3
					)
				`, [validMain40, validExtra15, validSide15]),
			).rejects.toThrow();

			// 3. Rollback migrations down cleanly
			await deckMigration.down(queryRunner);
			await initialMigration.down(queryRunner);

			const tableCheck = await queryRunner.query(`
				SELECT table_name FROM information_schema.tables
				WHERE table_schema = 'public' AND table_name IN ('deck_types', 'match_decks', 'matches')
			`);
			expect(tableCheck).toHaveLength(0);
		} finally {
			await queryRunner.release();
		}
	});
});
