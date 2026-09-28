import { DataSource, QueryRunner } from "typeorm";
import { InitialRankedSchema1741000000000 } from "../../../../../evolution-types/src/migrations/1741000000000-InitialRankedSchema";
import { AddReplayDeckAccess1741000001000 } from "../../../../../evolution-types/src/migrations/1741000001000-AddReplayDeckAccess";
import { AddHalfYearUsageStatistics1741000002000 } from "../../../../../evolution-types/src/migrations/1741000002000-AddHalfYearUsageStatistics";
import { AddHalfYearDeckMatchups1741000003000 } from "../../../../../evolution-types/src/migrations/1741000003000-AddHalfYearDeckMatchups";
import { UsageStatisticsPostgresRepository } from "./UsageStatisticsPostgresRepository";

describe("UsageStatisticsPostgresRepository Integration", () => {
	let ds: DataSource | undefined;
	let ds2: DataSource | undefined;
	let suiteLockRunner: QueryRunner | undefined;
	let isDbAvailable = false;

	beforeAll(async () => {
		try {
			const dbConfig = {
				type: "postgres" as const,
				host: process.env.POSTGRES_TEST_HOST ?? "127.0.0.1",
				port: process.env.POSTGRES_TEST_PORT ? Number(process.env.POSTGRES_TEST_PORT) : 5434,
				username: process.env.POSTGRES_TEST_USER ?? "postgres",
				password: process.env.POSTGRES_TEST_PASSWORD ?? "postgres",
				database: process.env.POSTGRES_TEST_DB ?? "evolution",
				synchronize: false,
				logging: false,
			};
			ds = new DataSource(dbConfig);
			await ds.initialize();
			suiteLockRunner = ds.createQueryRunner();
			await suiteLockRunner.connect();
			await suiteLockRunner.query("SELECT pg_advisory_lock(88888888)");
			ds2 = new DataSource(dbConfig);
			await ds2.initialize();
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
		if (ds?.isInitialized) await ds.destroy();
		if (ds2?.isInitialized) await ds2.destroy();
	});

	it("acquires and releases advisory lock across connections", async () => {
		if (!isDbAvailable || !ds || !ds2) return;
		const repo1 = new UsageStatisticsPostgresRepository(ds);
		const repo2 = new UsageStatisticsPostgresRepository(ds2);

		const locked1 = await repo1.tryAcquireAdvisoryLock("1109");
		expect(locked1).toBe(true);

		// Second connection cannot acquire the same lock
		const locked2 = await repo2.tryAcquireAdvisoryLock("1109");
		expect(locked2).toBe(false);

		// But connection 2 can acquire lock for 1103 (isolated)
		const locked1103 = await repo2.tryAcquireAdvisoryLock("1103");
		expect(locked1103).toBe(true);

		await repo1.releaseAdvisoryLock("1109");
		await repo2.releaseAdvisoryLock("1103");

		// Now connection 2 can acquire 1109
		const locked2Again = await repo2.tryAcquireAdvisoryLock("1109");
		expect(locked2Again).toBe(true);
		await repo2.releaseAdvisoryLock("1109");
	});

	it("streams valid snapshots with cursor pagination and excludes deleted/annulled", async () => {
		if (!isDbAvailable || !ds) return;
		const queryRunner = ds.createQueryRunner();

		try {
			await queryRunner.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
			await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

			await new InitialRankedSchema1741000000000().up(queryRunner);
			await new AddReplayDeckAccess1741000001000().up(queryRunner);
			await new AddHalfYearUsageStatistics1741000002000().up(queryRunner);
			await new AddHalfYearDeckMatchups1741000003000().up(queryRunner);

			await queryRunner.query(`
				INSERT INTO "users" ("id", "username", "password", "email") VALUES
					('u-repo-1', 'repouser', 'hash', 'repo@test.com')
				ON CONFLICT ("id") DO NOTHING;
			`);

			const sampleMatches = [
				{ id: "m-stream-1", date: "2026-07-02 10:00:00", anulled: false, deleted: false },
				{ id: "m-stream-2", date: "2026-07-03 11:00:00", anulled: true, deleted: false }, // annulled
				{ id: "m-stream-3", date: "2026-07-04 12:00:00", anulled: false, deleted: true }, // deleted
				{ id: "m-stream-4", date: "2026-07-05 13:00:00", anulled: false, deleted: false },
			];

			let idx = 0;
			for (const sm of sampleMatches) {
				idx++;
				const testGameId = `c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c2${idx}`;
				await queryRunner.query(
					`
					INSERT INTO "matches" (
						"id", "user_id", "game_id", "format_id", "best_of", "player_names",
						"opponent_names", "date", "ban_list_name", "ban_list_hash",
						"player_score", "opponent_score", "winner", "season", "points",
						"anulled", "deleted_at"
					) VALUES (
						$1, 'u-repo-1', '${testGameId}', '1109', 3, 'player1',
						'player2', $2::timestamp, '1109.0', 'hash', 2, 1, true, 1, 100,
						$3, CASE WHEN $4 THEN NOW() ELSE NULL END
					);
				`,
					[sm.id, sm.date, sm.anulled, sm.deleted],
				);

				await queryRunner.query(
					`
					INSERT INTO "match_decks" (
						"match_id", "format_id", "deck_type_code", "classifier_version",
						"snapshot_source", "main_cards", "extra_cards", "side_cards"
					) VALUES (
						$1, '1109', 'D01', 'v1', 'online', $2, $3, $4
					);
				`,
					[sm.id, Array(40).fill(10000), Array(15).fill(20000), [30000]],
				);
			}

			const repo = new UsageStatisticsPostgresRepository(ds);
			const streamed: any[] = [];
			for await (const s of repo.streamValidSnapshots("1109", "2026-07-01", "2026-07-10", 2)) {
				streamed.push(s);
			}

			expect(streamed).toHaveLength(2);
			expect(streamed.map((s) => s.matchId)).toEqual(["m-stream-1", "m-stream-4"]);
		} finally {
			await queryRunner.release();
		}
	});

	it("publishes period statistics in short transaction and supports idempotent rerun", async () => {
		if (!isDbAvailable || !ds) return;
		const repo = new UsageStatisticsPostgresRepository(ds);

		const runData = {
			formatId: "1109",
			windowStart: "2026-07-01",
			windowEndExclusive: "2027-01-01",
			dataEndExclusive: "2026-09-27",
			totalDecks: 50,
			sideKnownDecks: 45,
			publishedAt: new Date(),
		};

		const deckRows = [
			{ formatId: "1109", windowStart: "2026-07-01", deckTypeCode: "D01", deckCount: 30 },
			{ formatId: "1109", windowStart: "2026-07-01", deckTypeCode: "OTHERS", deckCount: 20 },
		];

		const cardRows = [
			{
				formatId: "1109",
				windowStart: "2026-07-01",
				metric: "monster" as const,
				cardId: 10000,
				deckCount: 25,
				copies1: 5,
				copies2: 10,
				copies3: 10,
			},
		];

		// First publish
		await repo.publishPeriodStatistics(runData, deckRows, cardRows);

		const run = await repo.findRun("1109", "2026-07-01");
		expect(run).toBeDefined();
		expect(run?.totalDecks).toBe(50);
		expect(run?.sideKnownDecks).toBe(45);

		const allRuns = await repo.listPublishedRuns("1109");
		expect(allRuns).toHaveLength(1);

		// Rerun with updated numbers
		const updatedRunData = { ...runData, totalDecks: 60, dataEndExclusive: "2026-09-28" };
		const updatedDeckRows = [
			{ formatId: "1109", windowStart: "2026-07-01", deckTypeCode: "D01", deckCount: 40 },
			{ formatId: "1109", windowStart: "2026-07-01", deckTypeCode: "OTHERS", deckCount: 20 },
		];
		await repo.publishPeriodStatistics(updatedRunData, updatedDeckRows, cardRows);

		const rerun = await repo.findRun("1109", "2026-07-01");
		expect(rerun?.totalDecks).toBe(60);
		expect(rerun?.dataEndExclusive).toBe("2026-09-28");
	});

	it("queries physical match perspectives with deck classifications and G1 seats", async () => {
		if (!isDbAvailable || !ds) return;
		const queryRunner = ds.createQueryRunner();
		try {
			await queryRunner.query(`
				INSERT INTO "users" ("id", "username", "password", "email") VALUES
					('u-matchup-1', 'player1', 'hash', 'p1@test.com'),
					('u-matchup-2', 'player2', 'hash', 'p2@test.com')
				ON CONFLICT ("id") DO NOTHING;
			`);

			const gameId = "11111111-2222-3333-4444-555555555555";
			await queryRunner.query(`
				INSERT INTO "matches" (
					"id", "user_id", "game_id", "format_id", "best_of", "player_names", "opponent_names",
					"date", "ban_list_name", "ban_list_hash", "player_score", "opponent_score", "winner",
					"season", "points", "anulled"
				) VALUES 
					('m-p-1', 'u-matchup-1', '${gameId}', '1109', 3, 'P1', 'P2', '2026-07-03 10:00:00', '1109', 'hash', 2, 1, true, 202601, 1000, false),
					('m-p-2', 'u-matchup-2', '${gameId}', '1109', 3, 'P2', 'P1', '2026-07-03 10:00:00', '1109', 'hash', 1, 2, false, 202601, 1000, false);
			`);

			await queryRunner.query(`
				INSERT INTO "match_decks" ("match_id", "format_id", "deck_type_code", "classifier_version", "snapshot_source", "main_cards", "extra_cards")
				VALUES 
					('m-p-1', '1109', 'D01', 'v1', 'online', '{10000}', '{}'),
					('m-p-2', '1109', 'D02', 'v1', 'online', '{20000}', '{}');
			`);

			await queryRunner.query(`
				INSERT INTO "duels" (
					"id", "match_id", "user_id", "game_id", "replay_id", "player_names", "opponent_names",
					"date", "ban_list_name", "ban_list_hash", "result", "turns", "season", "duel_index", "is_first"
				) VALUES 
					('d-p-1', 'm-p-1', 'u-matchup-1', '${gameId}', '11111111-0000-0000-0000-000000000001', 'P1', 'P2', '2026-07-03 10:00:00', '1109', 'hash', 1, 5, 202601, 1, true),
					('d-p-2', 'm-p-2', 'u-matchup-2', '${gameId}', '11111111-0000-0000-0000-000000000001', 'P2', 'P1', '2026-07-03 10:00:00', '1109', 'hash', 2, 5, 202601, 1, false);
			`);

			const repo = new UsageStatisticsPostgresRepository(ds);
			const perspectives = await repo.queryPhysicalMatchPerspectives(
				"1109",
				"2026-07-01",
				"2026-07-10",
			);

			const gamePerspectives = perspectives.filter((p) => p.gameId === gameId);
			expect(gamePerspectives).toHaveLength(2);
			const p1 = gamePerspectives.find((p) => p.userId === "u-matchup-1");
			const p2 = gamePerspectives.find((p) => p.userId === "u-matchup-2");
			expect(p1?.deckTypeCode).toBe("D01");
			expect(p1?.g1IsFirst).toBe(true);
			expect(p1?.winner).toBe(true);
			expect(p2?.deckTypeCode).toBe("D02");
			expect(p2?.g1IsFirst).toBe(false);
			expect(p2?.winner).toBe(false);
		} finally {
			await queryRunner.release();
		}
	});

	it("publishes matchup rows atomically and checks hasMatchupData", async () => {
		if (!isDbAvailable || !ds) return;
		const repo = new UsageStatisticsPostgresRepository(ds);

		const windowStart = "2026-07-01";
		expect(await repo.hasMatchupData("1109", windowStart)).toBe(false);

		const runData = {
			formatId: "1109",
			windowStart,
			windowEndExclusive: "2027-01-01",
			dataEndExclusive: "2026-09-27",
			totalDecks: 10,
			sideKnownDecks: 10,
			publishedAt: new Date(),
		};
		const deckRows = [
			{ formatId: "1109", windowStart, deckTypeCode: "D01", deckCount: 5 },
			{ formatId: "1109", windowStart, deckTypeCode: "D02", deckCount: 5 },
		];
		const cardRows = [
			{
				formatId: "1109",
				windowStart,
				metric: "monster" as const,
				cardId: 10000,
				deckCount: 5,
				copies1: 5,
				copies2: 0,
				copies3: 0,
			},
		];
		const matchupRows = [
			{
				formatId: "1109",
				windowStart,
				firstDeckCode: "D01",
				secondDeckCode: "D02",
				matchCount: 3,
				firstWins: 2,
			},
		];

		// Publish with matchups
		await repo.publishPeriodStatistics(runData, deckRows, cardRows, matchupRows);

		expect(await repo.hasMatchupData("1109", windowStart)).toBe(true);

		// Verify rows in DB
		const rows: any[] = await ds.query(
			`SELECT * FROM "stats_deck_matchups" WHERE format_id = '1109' AND window_start = $1::date;`,
			[windowStart],
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].first_deck_code).toBe("D01");
		expect(rows[0].second_deck_code).toBe("D02");
		expect(Number(rows[0].match_count)).toBe(3);
		expect(Number(rows[0].first_wins)).toBe(2);

		// Format 1103 isolation: 1103 hasMatchupData is always true and does not touch stats_deck_matchups
		expect(await repo.hasMatchupData("1103", windowStart)).toBe(true);
	});
});
