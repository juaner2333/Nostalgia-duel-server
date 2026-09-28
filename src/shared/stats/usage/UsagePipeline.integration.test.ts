import { DataSource, QueryRunner } from "typeorm";
import { InitialRankedSchema1741000000000 } from "../../../evolution-types/src/migrations/1741000000000-InitialRankedSchema";
import { AddReplayDeckAccess1741000001000 } from "../../../evolution-types/src/migrations/1741000001000-AddReplayDeckAccess";
import { AddHalfYearUsageStatistics1741000002000 } from "../../../evolution-types/src/migrations/1741000002000-AddHalfYearUsageStatistics";
import { UsageStatisticsPostgresRepository } from "./infrastructure/postgres/UsageStatisticsPostgresRepository";
import { CdbCardMetadataProvider } from "./infrastructure/cdb/CdbCardMetadataProvider";
import { RebuildUsageStatisticsUseCase } from "./application/RebuildUsageStatisticsUseCase";
import { GetUsageStatisticsUseCase } from "./application/GetUsageStatisticsUseCase";
import { GetUsageStatisticsController } from "../../../http-server/controllers/GetUsageStatisticsController";
import { GetUsagePeriodsController } from "../../../http-server/controllers/GetUsagePeriodsController";
import { UsageDashboardPageController } from "../../../http-server/controllers/UsageDashboardPageController";
import { HalfYearWindow } from "./domain/HalfYearWindow";
import { config } from "src/config";

describe("Usage Pipeline Integration (End-to-End)", () => {
	let ds: DataSource;
	let suiteLockRunner: QueryRunner | undefined;
	let metadataProvider: CdbCardMetadataProvider;
	const originalRanking = config.ranking.enabled;

	beforeAll(async () => {
		metadataProvider = new CdbCardMetadataProvider();
		await metadataProvider.load();

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

		const runner = ds.createQueryRunner();
		await runner.query(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`);
		await runner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

		await new InitialRankedSchema1741000000000().up(runner);
		await new AddReplayDeckAccess1741000001000().up(runner);
		await new AddHalfYearUsageStatistics1741000002000().up(runner);
		await runner.release();
	});

	afterAll(async () => {
		if (ds?.isInitialized) {
			const runner = ds.createQueryRunner();
			try {
				await new AddHalfYearUsageStatistics1741000002000().down(runner);
				await new AddReplayDeckAccess1741000001000().down(runner);
				await new InitialRankedSchema1741000000000().down(runner);
			} catch {
				// Clean down
			} finally {
				await runner.release();
			}
		}
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
		config.ranking.enabled = originalRanking;
	});

	beforeEach(async () => {
		config.ranking.enabled = true;
		await ds.query("DELETE FROM usage_card_rows");
		await ds.query("DELETE FROM usage_deck_rows");
		await ds.query("DELETE FROM usage_stat_runs");
		await ds.query("DELETE FROM match_decks");
		await ds.query("DELETE FROM matches");
		await ds.query("DELETE FROM users");
	});

	it("runs full pipeline: source data -> rebuild -> API -> page for both 1103 and 1109", async () => {
		// 1. Seed users (conforming to real InitialRankedSchema)
		await ds.query(`
			INSERT INTO "users" ("id", "username", "password", "email")
			VALUES 
				('u-alice', 'Alice', 'pass', 'alice@test.com'),
				('u-bob', 'Bob', 'pass', 'bob@test.com');
		`);

		// Valid 40 card mains
		const main40Cards1 = Array(40).fill(44095762); // Mirror Force
		const main40Cards2 = Array(40).fill(70781052); // Cyber Dragon
		const main40Hero = [...Array(20).fill(58932615), ...Array(20).fill(79979666)]; // Stratos & Neos Alius
		const main40Agent = Array(40).fill(33017655);

		// 2. Seed 1103 matches (2026-03-10 UTC+8)
		await ds.query(`
			INSERT INTO "matches" (
				"id", "user_id", "game_id", "format_id", "best_of",
				"player_names", "opponent_names", "date", "ban_list_name", "ban_list_hash",
				"player_score", "opponent_score", "winner", "season", "points", "anulled"
			) VALUES 
				(
					'm-1103-p1', 'u-alice', '00000000-0000-0000-0000-000000000101', '1103', 3,
					'Alice', 'Bob', '2026-03-10 12:00:00'::timestamp, '1103', '1103',
					2, 0, true, 1, 100, false
				),
				(
					'm-1103-p2', 'u-bob', '00000000-0000-0000-0000-000000000101', '1103', 3,
					'Bob', 'Alice', '2026-03-10 12:00:00'::timestamp, '1103', '1103',
					0, 2, false, 1, 0, false
				);
		`);

		// 1103 decks: Deck 1 with side, Deck 2 side null
		await ds.query(
			`
			INSERT INTO "match_decks" (
				"match_id", "format_id", "deck_type_code", "classifier_version",
				"snapshot_source", "main_cards", "extra_cards", "side_cards"
			) VALUES 
				('m-1103-p1', '1103', 'OTHERS', 'v1', 'online', $1, '{}', $2),
				('m-1103-p2', '1103', 'OTHERS', 'v1', 'online', $3, '{}', NULL);
		`,
			[main40Cards1, [70781052], main40Cards2],
		);

		// 3. Seed 1109 matches (2026-03-12 UTC+8)
		await ds.query(`
			INSERT INTO "matches" (
				"id", "user_id", "game_id", "format_id", "best_of",
				"player_names", "opponent_names", "date", "ban_list_name", "ban_list_hash",
				"player_score", "opponent_score", "winner", "season", "points", "anulled"
			) VALUES 
				(
					'm-1109-p1', 'u-alice', '00000000-0000-0000-0000-000000000201', '1109', 3,
					'Alice', 'Bob', '2026-03-12 12:00:00'::timestamp, '1109', '1109',
					2, 0, true, 1, 100, false
				),
				(
					'm-1109-p2', 'u-bob', '00000000-0000-0000-0000-000000000201', '1109', 3,
					'Bob', 'Alice', '2026-03-12 12:00:00'::timestamp, '1109', '1109',
					0, 2, false, 1, 0, false
				);
		`);

		// 1109 decks:
		// Slot 1: HB (D02), side: [44095762]
		// Slot 2: Agent (D01), side: NULL
		await ds.query(
			`
			INSERT INTO "match_decks" (
				"match_id", "format_id", "deck_type_code", "classifier_version",
				"snapshot_source", "main_cards", "extra_cards", "side_cards"
			) VALUES 
				('m-1109-p1', '1109', 'D02', 'v1', 'online', $1, '{}', $2),
				('m-1109-p2', '1109', 'D01', 'v1', 'online', $3, '{}', NULL);
		`,
			[main40Hero, [44095762], main40Agent],
		);

		const repo = new UsageStatisticsPostgresRepository(ds);
		const rebuildUseCase = new RebuildUsageStatisticsUseCase(repo, metadataProvider);

		// Execute rebuild for 2026H1
		const window = HalfYearWindow.fromPeriodString("2026H1", "2026-09-28");
		const run1103 = await rebuildUseCase.rebuildFormatWindow("1103", window);
		const run1109 = await rebuildUseCase.rebuildFormatWindow("1109", window);

		expect(run1103.totalDecks).toBe(2);
		expect(run1103.sideKnownDecks).toBe(1);

		expect(run1109.totalDecks).toBe(2);
		expect(run1109.sideKnownDecks).toBe(1);

		// 4. Test GetUsageStatisticsUseCase for 1103
		const getUseCase = new GetUsageStatisticsUseCase(repo, metadataProvider);
		const result1103Decks = await getUseCase.getUsage({
			format: "1103",
			period: "2026H1",
			metric: "deck",
			page: 1,
			pageSize: 50,
		});

		expect(result1103Decks.totalDecks).toBe(2);
		expect(result1103Decks.sideKnownDecks).toBe(1);
		// 1103 must categorize all decks as OTHERS
		expect(result1103Decks.decks).toBeDefined();
		expect(result1103Decks.decks).toHaveLength(1);
		expect(result1103Decks.decks![0]).toMatchObject({
			code: "OTHERS",
			nameZh: "其他",
			deckCount: 2,
			usageRate: 1.0,
			rank: 1,
		});

		// 1103 Side metric: denominator is sideKnownDecks (1)
		const result1103Side = await getUseCase.getUsage({
			format: "1103",
			period: "2026H1",
			metric: "side",
			page: 1,
			pageSize: 50,
		});
		expect(result1103Side.cards).toBeDefined();
		expect(result1103Side.cards).toHaveLength(1);
		expect(result1103Side.cards![0]).toMatchObject({
			cardId: 70781052,
			deckCount: 1,
			usageRate: 1.0, // 1 / 1
		});

		// 5. Test GetUsageStatisticsUseCase for 1109
		const result1109Decks = await getUseCase.getUsage({
			format: "1109",
			period: "2026H1",
			metric: "deck",
			page: 1,
			pageSize: 50,
		});
		expect(result1109Decks.totalDecks).toBe(2);
		// Expect both archetypes recognized (D02 and D01)
		const codes = result1109Decks.decks!.map((i) => i.code);
		expect(codes).toContain("D02");
		expect(codes).toContain("D01");

		// 1109 Side metric: denominator is sideKnownDecks (1)
		const result1109Side = await getUseCase.getUsage({
			format: "1109",
			period: "2026H1",
			metric: "side",
			page: 1,
			pageSize: 50,
		});
		expect(result1109Side.cards).toBeDefined();
		expect(result1109Side.cards).toHaveLength(1);
		expect(result1109Side.cards![0]).toMatchObject({
			cardId: 44095762,
			deckCount: 1,
			usageRate: 1.0, // 1 / 1
		});

		// 6. Test HTTP Controllers
		const periodsController = new GetUsagePeriodsController(getUseCase);
		const mockPeriodsRes: any = {
			status: jest.fn().mockReturnThis(),
			json: jest.fn().mockReturnThis(),
		};
		await periodsController.run({ params: { format: "1109" } } as any, mockPeriodsRes);
		expect(mockPeriodsRes.json).toHaveBeenCalled();
		const periodsPayload = mockPeriodsRes.json.mock.calls[0][0];
		expect(periodsPayload.format).toBe("1109");
		expect(periodsPayload.periods).toHaveLength(1);
		expect(periodsPayload.periods[0].period).toBe("2026H1");

		const statsController = new GetUsageStatisticsController(getUseCase);
		const mockStatsRes: any = {
			status: jest.fn().mockReturnThis(),
			json: jest.fn().mockReturnThis(),
		};
		await statsController.run(
			{
				params: { format: "1109" },
				query: { period: "2026H1", metric: "deck" },
			} as any,
			mockStatsRes,
		);
		expect(mockStatsRes.json).toHaveBeenCalled();
		const statsPayload = mockStatsRes.json.mock.calls[0][0];
		expect(statsPayload.metric).toBe("deck");
		expect(statsPayload.totalDecks).toBe(2);
		expect(statsPayload.decks).toHaveLength(2);

		// 7. Test Dashboard Page Controller renders valid HTML
		const pageController = new UsageDashboardPageController();
		const mockPageRes: any = {
			status: jest.fn().mockReturnThis(),
			setHeader: jest.fn().mockReturnThis(),
			send: jest.fn().mockReturnThis(),
		};
		pageController.run({ params: { format: "1109" } } as any, mockPageRes);
		expect(mockPageRes.send).toHaveBeenCalled();
		const html = mockPageRes.send.mock.calls[0][0];
		expect(html).toContain("1109 卡组与卡片使用率");
		expect(html).toContain("返回决斗专区");

		// 8. Re-run idempotence check: re-running does not duplicate rows
		await rebuildUseCase.rebuildFormatWindow("1109", window);
		const countRuns = await ds.query(
			"SELECT COUNT(*) AS c FROM usage_stat_runs WHERE format_id = '1109'",
		);
		expect(Number(countRuns[0].c)).toBe(1);
	});
});
