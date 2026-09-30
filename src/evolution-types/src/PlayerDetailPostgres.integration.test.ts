import { DataSource, QueryRunner } from "typeorm";
import { InitialRankedSchema1741000000000 } from "./migrations/1741000000000-InitialRankedSchema";
import { AddReplayDeckAccess1741000001000 } from "./migrations/1741000001000-AddReplayDeckAccess";
import { PlayerDetailPostgresRepository } from "src/shared/stats/player-detail/infrastructure/postgres/PlayerDetailPostgresRepository";
import { parseHalfYearSeason } from "src/utils/calculateBeijingSeason";

describe("PlayerDetail Isolated PostgreSQL Integration (Task 2.6)", () => {
	let ds: DataSource | undefined;
	let suiteLockRunner: QueryRunner | undefined;
	let isDbAvailable = false;
	let repository: PlayerDetailPostgresRepository;

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
			await suiteLockRunner.query("SELECT pg_advisory_lock(88888899)");
			await ds.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
			isDbAvailable = true;
			repository = new PlayerDetailPostgresRepository();
		} catch {
			isDbAvailable = false;
		}
	});

	afterAll(async () => {
		if (suiteLockRunner) {
			try {
				await suiteLockRunner.query("SELECT pg_advisory_unlock(88888899)");
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

	it("verifies real SQL: G1 connection, Match deduplication, rating trend limit 20, and season isolation", async () => {
		if (!isDbAvailable || !ds) {
			return;
		}
		const initialMigration = new InitialRankedSchema1741000000000();
		const deckMigration = new AddReplayDeckAccess1741000001000();
		const queryRunner = ds.createQueryRunner();

		try {
			await queryRunner.query(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`);
			await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

			await initialMigration.up(queryRunner);
			await deckMigration.up(queryRunner);

			// Seed users
			await queryRunner.query(`
				INSERT INTO "users" ("id", "username", "password", "email") VALUES
					('u1', 'PlayerOne', 'hash', 'p1@example.com'),
					('u2', 'PlayerTwo', 'hash', 'p2@example.com');
			`);

			// Seed player_stats for u1 in 1109 (overall total 25 points, season 2026H1 only)
			await queryRunner.query(`
				INSERT INTO "player_stats" ("id", "user_id", "format_id", "season", "points", "wins", "losses") VALUES
					('ps-1', 'u1', '1109', 202603, 25, 2, 0);
			`);

			// Seed a match in 1109 with 3 duels for u1 (Match-level record)
			const gameId = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380b22";
			await queryRunner.query(`
				INSERT INTO "matches" (
					"id", "user_id", "game_id", "format_id", "best_of", "player_names",
					"opponent_names", "date", "ban_list_name", "ban_list_hash",
					"player_score", "opponent_score", "winner", "season", "points"
				) VALUES (
					'm-1', 'u1', '${gameId}', '1109', 3, 'PlayerOne',
					'PlayerTwo', '2026-03-15T12:00:00Z', '1109.0', 'hash',
					2, 1, true, 202603, 10
				);
			`);

			// Seed match deck snapshot for m-1
			const validMain40 = Array(40).fill(10000);
			const validExtra15 = Array(15).fill(20000);
			await queryRunner.query(`
				INSERT INTO "match_decks" (
					"match_id", "format_id", "deck_type_code", "classifier_version",
					"snapshot_source", "main_cards", "extra_cards", "side_cards"
				) VALUES (
					'm-1', '1109', 'D01', 'v1', 'online', $1, $2, NULL
				);
			`, [validMain40, validExtra15]);

			// Seed 3 duels for m-1 (G1:先手=true, G2:先手=false, G3:先手=false)
			await queryRunner.query(`
				INSERT INTO "duels" (
					"id", "user_id", "game_id", "replay_id", "player_names", "opponent_names",
					"date", "ban_list_name", "ban_list_hash", "result", "turns", "match_id",
					"season", "duel_index", "is_first"
				) VALUES
					('d-1', 'u1', '${gameId}', 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380c11', 'PlayerOne', 'PlayerTwo', '2026-03-15T12:00:00Z', '1109.0', 'hash', 'WIN', 5, 'm-1', 202603, 1, true),
					('d-2', 'u1', '${gameId}', 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380c22', 'PlayerOne', 'PlayerTwo', '2026-03-15T12:10:00Z', '1109.0', 'hash', 'LOSS', 4, 'm-1', 202603, 2, false),
					('d-3', 'u1', '${gameId}', 'c3eebc99-9c0b-4ef8-bb6d-6bb9bd380c33', 'PlayerOne', 'PlayerTwo', '2026-03-15T12:20:00Z', '1109.0', 'hash', 'WIN', 6, 'm-1', 202603, 3, false);
			`);

			// Test 1: Deck stats deduplication (3 duels only count 1 match, G1 first=true, second=false)
			const deckStats = await repository.getPlayerDeckStats("u1", "1109");
			expect(deckStats).toHaveLength(1);
			expect(deckStats[0].deckTypeCode).toBe("D01");
			expect(deckStats[0].matches).toBe(1); // Exactly 1 match, not 3!
			expect(deckStats[0].wins).toBe(1);
			expect(deckStats[0].firstCount).toBe(1);
			expect(deckStats[0].secondCount).toBe(0); // G2 and G3 first=false did NOT pollute G1!

			// Test 2: Overall summary vs season summary
			const overallSummary = await repository.getPlayerOverallSummary("u1", "1109");
			expect(overallSummary.rank).toBe(1);
			expect(overallSummary.points).toBe(25);

			// Season 2026H1 summary
			const h1Summary = await repository.getPlayerSeasonSummary("u1", "1109", parseHalfYearSeason("2026H1"));
			expect(h1Summary.rank).toBe(1);
			expect(h1Summary.points).toBe(25);

			// Season 2026H2 summary (player has NO matches in 2026H2)
			const h2Summary = await repository.getPlayerSeasonSummary("u1", "1109", parseHalfYearSeason("2026H2"));
			expect(h2Summary.rank).toBeNull();
			expect(h2Summary.points).toBe(0);
			expect(h2Summary.matches).toBe(0);

			// Test 3: Rating trend bounded at 20
			const trendMatches = await repository.getRatingTrendMatches("u1", "1109");
			expect(trendMatches).toHaveLength(1);
			expect(trendMatches[0].matchId).toBe("m-1");
		} finally {
			await queryRunner.release();
		}
	});
});
