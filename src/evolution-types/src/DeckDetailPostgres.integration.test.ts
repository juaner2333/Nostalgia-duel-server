import { DataSource, QueryRunner } from "typeorm";
import { InitialRankedSchema1741000000000 } from "./migrations/1741000000000-InitialRankedSchema";
import { AddReplayDeckAccess1741000001000 } from "./migrations/1741000001000-AddReplayDeckAccess";
import { AddHalfYearUsageStatistics1741000002000 } from "./migrations/1741000002000-AddHalfYearUsageStatistics";
import { AddHalfYearDeckMatchups1741000003000 } from "./migrations/1741000003000-AddHalfYearDeckMatchups";
import { AddMatchupsEvaluated1790619192715 } from "./migrations/1790619192715-AddMatchupsEvaluated";
import { AddDeckDetailPrecomputedTables1790619192716 } from "./migrations/1790619192716-AddDeckDetailPrecomputedTables";
import { DeckDetailPostgresRepository } from "src/shared/stats/deck-detail/infrastructure/postgres/DeckDetailPostgresRepository";
import { DeckDetailTimeWindow } from "src/shared/stats/deck-detail/domain/DeckDetailRepository";

describe("DeckDetail PostgreSQL Integration (Tasks 2.1 - 2.6)", () => {
	let ds: DataSource | undefined;
	let suiteLockRunner: QueryRunner | undefined;
	let isDbAvailable = false;
	let repository: DeckDetailPostgresRepository;

	beforeAll(async () => {
		try {
			ds = new DataSource({
				type: "postgres",
				host: process.env.POSTGRES_TEST_HOST ?? "127.0.0.1",
				port: process.env.POSTGRES_TEST_PORT ? Number(process.env.POSTGRES_TEST_PORT) : 5434,
				username: process.env.POSTGRES_TEST_USER ?? "postgres",
				password: process.env.POSTGRES_TEST_PASSWORD ?? "postgres",
				database: process.env.POSTGRES_TEST_DB ?? "evolution_test",
				synchronize: false,
				logging: false,
			});
			await ds.initialize();
			suiteLockRunner = ds.createQueryRunner();
			await suiteLockRunner.connect();
			await suiteLockRunner.query("SELECT pg_advisory_lock(88888877)");
			await ds.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
			isDbAvailable = true;
			repository = new DeckDetailPostgresRepository(ds);
		} catch {
			isDbAvailable = false;
		}
	});

	afterAll(async () => {
		if (suiteLockRunner) {
			try {
				await suiteLockRunner.query("SELECT pg_advisory_unlock(88888877)");
			} catch {
				// Cleanup
			} finally {
				await suiteLockRunner.release();
			}
		}
		if (ds?.isInitialized) {
			await ds.destroy();
		}
	});

	it("verifies physical match integrity, OTHERS exclusion, unknown opponent, G1 seats, and Top10 threshold", async () => {
		if (!isDbAvailable || !ds) {
			return;
		}

		const initialMigration = new InitialRankedSchema1741000000000();
		const deckMigration = new AddReplayDeckAccess1741000001000();
		const usageMigration = new AddHalfYearUsageStatistics1741000002000();
		const matchupMigration = new AddHalfYearDeckMatchups1741000003000();
		const queryRunner = ds.createQueryRunner();

		try {
			await queryRunner.query(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`);
			await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

			await initialMigration.up(queryRunner);
			await deckMigration.up(queryRunner);
			await usageMigration.up(queryRunner);
			await matchupMigration.up(queryRunner);
			await new AddMatchupsEvaluated1790619192715().up(queryRunner);
			await new AddDeckDetailPrecomputedTables1790619192716().up(queryRunner);

			// Seed users
			await queryRunner.query(`
				INSERT INTO "users" ("id", "username", "password", "email") VALUES
					('u1', 'PlayerOne', 'hash', 'p1@example.com'),
					('u2', 'PlayerTwo', 'hash', 'p2@example.com'),
					('u3', 'PlayerThree', 'hash', 'p3@example.com'),
					('u4', 'PlayerFour', 'hash', 'p4@example.com'),
					('u5', 'PlayerFive', 'hash', 'p5@example.com'),
					('u6', 'GhostUser', 'hash', 'p6@example.com');
			`);

			// Helper to insert a physical match perspective
			const insertMatch = async (
				id: string,
				userId: string,
				gameId: string,
				dateStr: string,
				winner: boolean,
				pScore: number,
				oScore: number,
				anulled: boolean = false,
				deleted: boolean = false,
			) => {
				await queryRunner.query(
					`
					INSERT INTO "matches" (
						"id", "user_id", "game_id", "format_id", "best_of",
						"player_names", "opponent_names", "date", "ban_list_name", "ban_list_hash",
						"player_score", "opponent_score", "winner", "season", "points", "anulled", "deleted_at"
					) VALUES (
						$1, $2, $3, '1109', 3,
						'{p}', '{o}', $4::timestamp, '1109', 'hash',
						$5, $6, $7, 202609, 10, $8, ${deleted ? "NOW()" : "NULL"}
					)
				`,
					[id, userId, gameId, dateStr, pScore, oScore, winner, anulled],
				);
			};

			const insertDeck = async (matchId: string, code: string) => {
				await queryRunner.query(
					`
					INSERT INTO "match_decks" (
						"match_id", "format_id", "deck_type_code", "classifier_version", "snapshot_source", "main_cards", "extra_cards"
					) VALUES (
						$1, '1109', $2, 'v1', 'online', (SELECT array_agg(89631139) FROM generate_series(1, 40)), ARRAY[]::int[]
					)
				`,
					[matchId, code],
				);
			};

			const insertDuel = async (
				id: string,
				matchId: string,
				userId: string,
				gameId: string,
				duelIndex: number,
				isFirst: boolean | null,
			) => {
				await queryRunner.query(
					`
					INSERT INTO "duels" (
						"id", "match_id", "user_id", "game_id", "replay_id",
						"player_names", "opponent_names", "date", "ban_list_name", "ban_list_hash",
						"result", "turns", "season", "duel_index", "is_first"
					) VALUES (
						$1, $2, $3, $4, uuid_generate_v4(),
						'{p}', '{o}', '2026-08-01 12:00:00'::timestamp, '1109', 'hash',
						'WIN', 5, 202609, $5, $6
					)
				`,
					[id, matchId, userId, gameId, duelIndex, isFirst],
				);
			};

			// Game 1 (Valid: u1 D01 vs u2 D02, u1 wins 2-1, G1 u1 is_first=true, u2 is_first=false)
			const g1 = "a0000000-0000-0000-0000-000000000001";
			await insertMatch("m1-1", "u1", g1, "2026-08-01 10:00:00", true, 2, 1);
			await insertMatch("m1-2", "u2", g1, "2026-08-01 10:00:00", false, 1, 2);
			await insertDeck("m1-1", "D01");
			await insertDeck("m1-2", "D02");
			await insertDuel("d1-1", "m1-1", "u1", g1, 1, true);
			await insertDuel("d1-2", "m1-2", "u2", g1, 1, false);

			// Game 2 (Valid Mirror: u1 D01 vs u3 D01, u1 wins 2-0, G1 u1 is_first=false, u3 is_first=true)
			const g2 = "a0000000-0000-0000-0000-000000000002";
			await insertMatch("m2-1", "u1", g2, "2026-08-02 10:00:00", true, 2, 0);
			await insertMatch("m2-2", "u3", g2, "2026-08-02 10:00:00", false, 0, 2);
			await insertDeck("m2-1", "D01");
			await insertDeck("m2-2", "D01");
			await insertDuel("d2-1", "m2-1", "u1", g2, 1, false);
			await insertDuel("d2-2", "m2-2", "u3", g2, 1, true);

			// Game 3 (Valid Unknown Opponent: u1 D01 vs u4, no match_decks for u4, u1 loses 1-2, G1 missing -> unknown seat)
			const g3 = "a0000000-0000-0000-0000-000000000003";
			await insertMatch("m3-1", "u1", g3, "2026-08-03 10:00:00", false, 1, 2);
			await insertMatch("m3-2", "u4", g3, "2026-08-03 10:00:00", true, 2, 1);
			await insertDeck("m3-1", "D01");
			// u4 has no deck record

			// Game 4 (OTHERS opponent: u1 D01 vs u5 OTHERS -> excluded)
			const g4 = "a0000000-0000-0000-0000-000000000004";
			await insertMatch("m4-1", "u1", g4, "2026-08-04 10:00:00", true, 2, 0);
			await insertMatch("m4-2", "u5", g4, "2026-08-04 10:00:00", false, 0, 2);
			await insertDeck("m4-1", "D01");
			await insertDeck("m4-2", "OTHERS");

			// Game 5 (Annulled match: u1 D01 vs u2 D02, u2 annulled -> excluded)
			const g5 = "a0000000-0000-0000-0000-000000000005";
			await insertMatch("m5-1", "u1", g5, "2026-08-05 10:00:00", true, 2, 0, false);
			await insertMatch("m5-2", "u2", g5, "2026-08-05 10:00:00", false, 0, 2, true);
			await insertDeck("m5-1", "D01");
			await insertDeck("m5-2", "D02");

			// Game 6 (Deleted match: u1 D01 vs u2 D02, u1 deleted -> excluded)
			const g6 = "a0000000-0000-0000-0000-000000000006";
			await insertMatch("m6-1", "u1", g6, "2026-08-06 10:00:00", true, 2, 0, false, true);
			await insertMatch("m6-2", "u2", g6, "2026-08-06 10:00:00", false, 0, 2);
			await insertDeck("m6-1", "D01");
			await insertDeck("m6-2", "D02");

			// Game 7 (3 perspectives: u1, u2, u3 in same game -> excluded)
			const g7 = "a0000000-0000-0000-0000-000000000007";
			await insertMatch("m7-1", "u1", g7, "2026-08-07 10:00:00", true, 2, 0);
			await insertMatch("m7-2", "u2", g7, "2026-08-07 10:00:00", false, 0, 2);
			await insertMatch("m7-3", "u3", g7, "2026-08-07 10:00:00", false, 0, 2);
			await insertDeck("m7-1", "D01");
			await insertDeck("m7-2", "D02");
			await insertDeck("m7-3", "D02");

			// Game 8 (Single-sided: u1 only -> excluded)
			const g8 = "a0000000-0000-0000-0000-000000000008";
			await insertMatch("m8-1", "u1", g8, "2026-08-08 10:00:00", true, 2, 0);
			await insertDeck("m8-1", "D01");

			// Game 9 (Non-complementary scores: both winner=true -> excluded)
			const g9 = "a0000000-0000-0000-0000-000000000009";
			await insertMatch("m9-1", "u1", g9, "2026-08-09 10:00:00", true, 2, 0);
			await insertMatch("m9-2", "u2", g9, "2026-08-09 10:00:00", true, 2, 0);
			await insertDeck("m9-1", "D01");
			await insertDeck("m9-2", "D02");

			// Game 10 (Historical date: 2026-06-30 23:59:59 -> 2026H1, excluded from 2026H2)
			const g10 = "a0000000-0000-0000-0000-000000000010";
			await insertMatch("m10-1", "u1", g10, "2026-06-30 23:59:59", true, 2, 0);
			await insertMatch("m10-2", "u2", g10, "2026-06-30 23:59:59", false, 0, 2);
			await insertDeck("m10-1", "D01");
			await insertDeck("m10-2", "D02");

			// Seed 23 more matches for u1 on D01 vs u2 on D02 so u1 reaches 25 total valid matches on D01
			// u1 currently has:
			// Game 1: valid D01 win (matches=1, wins=1)
			// Game 2: valid D01 win (matches=2, wins=2)
			// Game 3: valid D01 loss (matches=3, wins=2)
			// Need 22 more matches:
			for (let i = 11; i <= 32; i++) {
				const hexId = i.toString(16).padStart(12, "0");
				const gameId = `b0000000-0000-0000-0000-${hexId}`;
				const mId1 = `m${i}-1`;
				const mId2 = `m${i}-2`;
				await insertMatch(mId1, "u1", gameId, "2026-08-15 10:00:00", true, 2, 0);
				await insertMatch(mId2, "u2", gameId, "2026-08-15 10:00:00", false, 0, 2);
				await insertDeck(mId1, "D01");
				await insertDeck(mId2, "D02");
			}

			// Seed 24 matches for u2 on D02 vs u3 on D03 (u2 has 23 losses above on D02 + 1 match = 24 matches on D02 < 25 -> excluded from D02 Top10)
			// u1 has 3 + 22 = 25 valid matches on D01 (24 wins, 1 loss, winRate = 24/25 = 96%)

			const window2026H2: DeckDetailTimeWindow = {
				period: "2026H2",
				windowStart: "2026-07-01 00:00:00",
				windowEndExclusive: "2027-01-01 00:00:00",
				dataEndExclusive: "2026-09-30 16:00:00",
				isOngoing: true,
			};

			const snapshot = await repository.getDeckDetailSnapshot("1109", "D01", window2026H2);

			// Check usage counts:
			// D01 has:
			// Game 1: u1 (1)
			// Game 2: u1 and u3 (2)
			// Game 3: u1 (1)
			// Games 11-32: u1 (22)
			// Total D01 usage count = 1 + 2 + 1 + 22 = 26
			const d01Usage = snapshot.usageCounts.find((u) => u.deckTypeCode === "D01");
			expect(d01Usage?.count).toBe(26);

			// D02 usage count:
			// Game 1: u2 (1)
			// Games 11-32: u2 (22)
			// Total D02 = 23
			const d02Usage = snapshot.usageCounts.find((u) => u.deckTypeCode === "D02");
			expect(d02Usage?.count).toBe(23);

			// Check matchups for D01:
			// Against D02:
			// Game 1 (u1 wins, seat 1) + Games 11-32 (u1 wins 22 matches, unknown seat since no duel rows) = 23 matches, 23 wins
			const vsD02 = snapshot.matchups.find((m) => m.opponentCode === "D02");
			expect(vsD02?.matches).toBe(23);
			expect(vsD02?.matchWins).toBe(23);
			expect(vsD02?.firstMatches).toBe(1);
			expect(vsD02?.firstWins).toBe(1);
			expect(vsD02?.unknownSeatMatches).toBe(22);

			// Against D01 (Mirror in Game 2):
			// Both u1 and u3 played D01 against D01!
			// u1 won (seat 2), u3 lost (seat 1).
			// Total mirror matches = 2, total wins = 1, first_matches = 1, second_matches = 1!
			const vsD01 = snapshot.matchups.find((m) => m.opponentCode === "D01");
			expect(vsD01?.matches).toBe(2);
			expect(vsD01?.matchWins).toBe(1);
			expect(vsD01?.firstMatches).toBe(1);
			expect(vsD01?.firstWins).toBe(0);
			expect(vsD01?.secondMatches).toBe(1);
			expect(vsD01?.secondWins).toBe(1);

			// Against unknown (Game 3):
			// 1 match, 0 wins, unknown seat = 1
			const vsUnknown = snapshot.matchups.find((m) => m.opponentCode === "unknown");
			expect(vsUnknown?.matches).toBe(1);
			expect(vsUnknown?.matchWins).toBe(0);
			expect(vsUnknown?.unknownSeatMatches).toBe(1);

			// Total D01 matches across matchups: 23 (vs D02) + 2 (vs D01) + 1 (vs unknown) = 26!
			// Notice that 26 matches EXACTLY equals D01 usage count (26)!

			// Check Top10 players for D01:
			// u1 has 25 valid matches on D01 (Game 1, Game 2, Game 3, Games 11-32).
			// u3 only has 1 match on D01 (< 25) -> not in top 10.
			expect(snapshot.topPlayers.length).toBe(1);
			expect(snapshot.topPlayers[0].username).toBe("PlayerOne");
			expect(snapshot.topPlayers[0].matches).toBe(25);
			expect(snapshot.topPlayers[0].wins).toBe(24);
			expect(snapshot.topPlayers[0].losses).toBe(1);
			expect(snapshot.topPlayers[0].winRate).toBeCloseTo(24 / 25);
		} finally {
			await queryRunner.release();
		}
	});

	it("2.5 verifies REPEATABLE READ snapshot isolation under concurrent settlement or annulment", async () => {
		if (!isDbAvailable || !ds) {
			return;
		}

		const queryRunner1 = ds.createQueryRunner();
		const queryRunner2 = ds.createQueryRunner();
		await queryRunner1.connect();
		await queryRunner2.connect();

		try {
			// Start transaction 1 with REPEATABLE READ READ ONLY and establish snapshot
			await queryRunner1.startTransaction("REPEATABLE READ");
			await queryRunner1.query("SET TRANSACTION READ ONLY;");
			await queryRunner1.query("SELECT clock_timestamp();"); // Establish snapshot

			// Concurrently annul a match in connection 2 and commit
			await queryRunner2.query(`UPDATE "matches" SET "anulled" = true WHERE "id" = 'm1-1';`);

			// Now query snapshot via connection 1 - should still see the un-annulled snapshot
			const countInTx1 = await queryRunner1.query(
				`SELECT anulled FROM matches WHERE id = 'm1-1';`,
			);
			expect(countInTx1[0].anulled).toBe(false);

			await queryRunner1.commitTransaction();

			// Outside tx 1, it is annulled
			const countOutside = await ds.query(
				`SELECT anulled FROM matches WHERE id = 'm1-1';`,
			);
			expect(countOutside[0].anulled).toBe(true);
		} finally {
			await queryRunner1.release();
			await queryRunner2.release();
		}
	});

	it("2.6 verifies strict Beijing wall-clock boundary conditions for half-year periods", async () => {
		if (!isDbAvailable || !ds) {
			return;
		}

		// Verify 2026H1 boundary: [2026-01-01 00:00:00, 2026-07-01 00:00:00)
		const window2026H1: DeckDetailTimeWindow = {
			period: "2026H1",
			windowStart: "2026-01-01 00:00:00",
			windowEndExclusive: "2026-07-01 00:00:00",
			dataEndExclusive: "2026-07-01 00:00:00",
			isOngoing: false,
		};

		const snapshotH1 = await repository.getDeckDetailSnapshot("1109", "D01", window2026H1);
		// In previous test, g10 was inserted at "2026-06-30 23:59:59" for D01 vs D02
		const d01UsageH1 = snapshotH1.usageCounts.find((u) => u.deckTypeCode === "D01");
		expect(d01UsageH1?.count).toBe(1);

		const vsD02H1 = snapshotH1.matchups.find((m) => m.opponentCode === "D02");
		expect(vsD02H1?.matches).toBe(1);
	});

	it("6.1 runs EXPLAIN (ANALYZE, BUFFERS) on queries to verify bounded execution plan", async () => {
		if (!isDbAvailable || !ds) {
			return;
		}

		const commonCte = (repository as any).buildCommonCteSql();
		const namedCodes = ["D01", "D02", "D03", "D04", "D05"];
		const cteParams = ["1109", "2026-01-01 00:00:00", "2026-07-01 00:00:00", namedCodes];

		const explainUsage = await ds.query(
			`EXPLAIN (ANALYZE, BUFFERS) ${commonCte} SELECT v.deck_type_code, COUNT(*)::int FROM valid_deck_perspectives v GROUP BY v.deck_type_code;`,
			cteParams,
		);
		expect(explainUsage.length).toBeGreaterThan(0);
		const usagePlanText = explainUsage.map((r: any) => r["QUERY PLAN"]).join("\n");
		expect(usagePlanText).not.toContain("replays");
		expect(usagePlanText).not.toContain("cards");

		const explainMatchup = await ds.query(
			`EXPLAIN (ANALYZE, BUFFERS) ${commonCte} SELECT COALESCE(v.opp_deck_type_code, 'unknown'), COUNT(*)::int FROM valid_deck_perspectives v WHERE v.deck_type_code = $5 GROUP BY COALESCE(v.opp_deck_type_code, 'unknown');`,
			[...cteParams, "D01"],
		);
		expect(explainMatchup.length).toBeGreaterThan(0);
		const matchupPlanText = explainMatchup.map((r: any) => r["QUERY PLAN"]).join("\n");
		expect(matchupPlanText).not.toContain("replays");
		expect(matchupPlanText).not.toContain("cards");

		const explainTopPlayers = await ds.query(
			`EXPLAIN (ANALYZE, BUFFERS) ${commonCte} SELECT u.username, COUNT(*)::int FROM valid_deck_perspectives v JOIN users u ON u.id = v.user_id WHERE v.deck_type_code = $5 GROUP BY v.user_id, u.username HAVING COUNT(*) >= 25 LIMIT 10;`,
			[...cteParams, "D01"],
		);
		expect(explainTopPlayers.length).toBeGreaterThan(0);
		const topPlayersPlanText = explainTopPlayers.map((r: any) => r["QUERY PLAN"]).join("\n");
		expect(topPlayersPlanText).not.toContain("replays");
		expect(topPlayersPlanText).not.toContain("cards");
	});

	it("7.1 verifies precomputed point lookup from stats_deck_detail_matchups and stats_deck_top_players", async () => {
		if (!isDbAvailable || !ds) {
			return;
		}

		// Insert into usage_stat_runs
		await ds.query(`
			INSERT INTO "usage_stat_runs" (
				"format_id", "window_start", "window_end_exclusive", "data_end_exclusive",
				"total_decks", "side_known_decks", "published_at", "matchups_evaluated"
			) VALUES (
				'1109', '2026-07-01', '2027-01-01', '2026-09-28', 100, 90, NOW(), true
			) ON CONFLICT ("format_id", "window_start") DO UPDATE 
			  SET "data_end_exclusive" = EXCLUDED."data_end_exclusive", "matchups_evaluated" = true;
		`);

		// Insert into usage_deck_rows
		await ds.query(`
			INSERT INTO "usage_deck_rows" ("format_id", "window_start", "deck_type_code", "deck_count")
			VALUES 
				('1109', '2026-07-01', 'D01', 40),
				('1109', '2026-07-01', 'D02', 30),
				('1109', '2026-07-01', 'OTHERS', 30)
			ON CONFLICT ("format_id", "window_start", "deck_type_code") DO NOTHING;
		`);

		// Insert into stats_deck_detail_matchups
		await ds.query(`
			INSERT INTO "stats_deck_detail_matchups" (
				"format_id", "window_start", "deck_type_code", "opp_deck_type_code",
				"matches", "match_wins", "first_matches", "first_wins",
				"second_matches", "second_wins", "unknown_seat_matches", "unknown_seat_wins"
			) VALUES (
				'1109', '2026-07-01', 'D01', 'D02',
				15, 10, 8, 6, 7, 4, 0, 0
			) ON CONFLICT ("format_id", "window_start", "deck_type_code", "opp_deck_type_code") DO NOTHING;
		`);

		// Insert into stats_deck_top_players
		await ds.query(`
			INSERT INTO "stats_deck_top_players" (
				"format_id", "window_start", "deck_type_code", "rank",
				"user_id", "username", "matches", "wins", "losses", "win_rate"
			) VALUES (
				'1109', '2026-07-01', 'D01', 1,
				'u1', 'PlayerOne', 30, 25, 5, 0.8333333333333334
			) ON CONFLICT ("format_id", "window_start", "deck_type_code", "rank") DO NOTHING;
		`);

		const window2026H2: DeckDetailTimeWindow = {
			period: "2026H2",
			windowStart: "2026-07-01 00:00:00",
			windowEndExclusive: "2027-01-01 00:00:00",
			dataEndExclusive: "2026-09-30 16:00:00",
			isOngoing: true,
		};

		const snapshot = await repository.getDeckDetailSnapshot("1109", "D01", window2026H2);

		expect(snapshot.timeWindow.dataEndExclusive).toBe("2026-09-28");
		expect(snapshot.usageCounts).toEqual([
			{ deckTypeCode: "D01", count: 40 },
			{ deckTypeCode: "D02", count: 30 },
		]);
		expect(snapshot.matchups).toEqual([
			{
				opponentCode: "D02",
				matches: 15,
				matchWins: 10,
				firstMatches: 8,
				firstWins: 6,
				secondMatches: 7,
				secondWins: 4,
				unknownSeatMatches: 0,
				unknownSeatWins: 0,
			},
		]);
		expect(snapshot.topPlayers).toEqual([
			{
				username: "PlayerOne",
				matches: 30,
				wins: 25,
				losses: 5,
				winRate: 0.8333333333333334,
			},
		]);
	});
});
