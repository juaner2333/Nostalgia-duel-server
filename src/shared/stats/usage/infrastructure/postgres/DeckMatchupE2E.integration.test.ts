import { DataSource } from "typeorm";
import { InitialRankedSchema1741000000000 } from "../../../../../evolution-types/src/migrations/1741000000000-InitialRankedSchema";
import { AddReplayDeckAccess1741000001000 } from "../../../../../evolution-types/src/migrations/1741000001000-AddReplayDeckAccess";
import { AddHalfYearUsageStatistics1741000002000 } from "../../../../../evolution-types/src/migrations/1741000002000-AddHalfYearUsageStatistics";
import { AddHalfYearDeckMatchups1741000003000 } from "../../../../../evolution-types/src/migrations/1741000003000-AddHalfYearDeckMatchups";
import { AddMatchupsEvaluated1790619192715 } from "../../../../../evolution-types/src/migrations/1790619192715-AddMatchupsEvaluated";
import { UsageStatisticsPostgresRepository } from "./UsageStatisticsPostgresRepository";
import { RebuildUsageStatisticsUseCase } from "../../application/RebuildUsageStatisticsUseCase";
import { CdbCardMetadataProvider } from "../cdb/CdbCardMetadataProvider";
import { HalfYearWindow } from "../../domain/HalfYearWindow";
import { GetDeckMatchupStatsUseCase } from "../../../matchup/application/GetDeckMatchupStatsUseCase";

describe("DeckMatchupE2EIntegration", () => {
	let ds: DataSource | undefined;
	let repository: UsageStatisticsPostgresRepository;
	let rebuildUseCase: RebuildUsageStatisticsUseCase;
	let getStatsUseCase: GetDeckMatchupStatsUseCase;
	let isDbAvailable = false;

	const MAIN_CARD_ID = 44095762; // Mirror Force, present in the bundled fixed CDB
	const MATCH_DATE = "2026-08-15 14:00:00";

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

			// Own the schema so this suite is independent of suite execution order
			const runner = ds.createQueryRunner();
			try {
				await runner.query(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`);
				await runner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
				await new InitialRankedSchema1741000000000().up(runner);
				await new AddReplayDeckAccess1741000001000().up(runner);
				await new AddHalfYearUsageStatistics1741000002000().up(runner);
				await new AddHalfYearDeckMatchups1741000003000().up(runner);
				await new AddMatchupsEvaluated1790619192715().up(runner);
			} finally {
				await runner.release();
			}

			repository = new UsageStatisticsPostgresRepository(ds);
			const metadataProvider = new CdbCardMetadataProvider();
			await metadataProvider.load();
			rebuildUseCase = new RebuildUsageStatisticsUseCase(repository, metadataProvider);
			getStatsUseCase = new GetDeckMatchupStatsUseCase(repository);
			isDbAvailable = true;
		} catch {
			isDbAvailable = false;
		}
	});

	afterAll(async () => {
		if (ds?.isInitialized) {
			await ds.destroy();
		}
	});

	beforeEach(async () => {
		if (!isDbAvailable || !ds) return;
		await ds.query(
			"TRUNCATE TABLE stats_deck_matchups, usage_card_rows, usage_deck_rows, usage_stat_runs, match_decks, duels, matches CASCADE",
		);
	});

	async function seedMatch(
		matchId: string,
		userId: string,
		gameId: string,
		deckCode: string,
		overrides: {
			playerName?: string;
			opponentName?: string;
			playerScore?: number;
			opponentScore?: number;
			winner?: boolean;
		} = {},
	): Promise<void> {
		await ds!.query(
			`
			INSERT INTO "matches" (
				"id", "user_id", "game_id", "format_id", "best_of", "player_names",
				"opponent_names", "date", "ban_list_name", "ban_list_hash",
				"player_score", "opponent_score", "winner", "season", "points"
			) VALUES (
				$1, $2, $3, '1109', 3, $4, $5, $6::timestamp, 'OCG 1109', '3094922383',
				$7, $8, $9, 202608, 100
			)
		`,
			[
				matchId,
				userId,
				gameId,
				overrides.playerName ?? "playerA",
				overrides.opponentName ?? "playerB",
				MATCH_DATE,
				overrides.playerScore ?? 2,
				overrides.opponentScore ?? 0,
				overrides.winner ?? true,
			],
		);

		await ds!.query(
			`
			INSERT INTO "match_decks" (
				"match_id", "format_id", "deck_type_code", "classifier_version",
				"snapshot_source", "main_cards", "extra_cards", "side_cards"
			) VALUES ($1, '1109', $2, '1109-c9ba01c-v1', 'online', $3, '{}', '{}')
		`,
			[matchId, deckCode, Array(40).fill(MAIN_CARD_ID)],
		);
	}

	async function seedDuel(
		duelId: string,
		userId: string,
		gameId: string,
		replayId: string,
		matchId: string,
		duelIndex: number,
		isFirst: boolean,
	): Promise<void> {
		await ds!.query(
			`
			INSERT INTO "duels" (
				"id", "user_id", "game_id", "replay_id", "player_names", "opponent_names",
				"date", "ban_list_name", "ban_list_hash", "result", "turns",
				"match_id", "season", "duel_index", "is_first"
			) VALUES (
				$1, $2, $3, $4, 'playerA', 'playerB',
				$5::timestamp, 'OCG 1109', '3094922383', 'win', 5,
				$6, 202608, $7, $8
			)
		`,
			[duelId, userId, gameId, replayId, MATCH_DATE, matchId, duelIndex, isFirst],
		);
	}

	it("rebuilds 1109 deck statistics end-to-end, validates Top 16 consistency, checksum, and API retrieval", async () => {
		if (!isDbAvailable || !ds) return;

		const period = "2026H2"; // 2026-07-01 to 2027-01-01

		// 18 named deck types; D18 has the fewest decks and must stay outside Top 16
		const testDecks = Array.from({ length: 18 }, (_, i) => `D${String(i + 1).padStart(2, "0")}`);

		// Seed one deck snapshot per single-perspective match so usage counts rank the decks
		let gCounter = 100;
		for (let i = 0; i < testDecks.length; i++) {
			const count = 20 - i; // D01=20, ..., D18=3
			for (let c = 0; c < count; c++) {
				gCounter++;
				const gameId = `a0000000-0000-4000-8000-${String(gCounter).padStart(12, "0")}`;
				await seedMatch(`m_${gCounter}_a`, `user_a_${gCounter}`, gameId, testDecks[i]);
			}
		}

		// OTHERS decks are counted in usage but never enter Top 15
		for (let c = 0; c < 30; c++) {
			gCounter++;
			const gameId = `a0000000-0000-4000-8000-${String(gCounter).padStart(12, "0")}`;
			await seedMatch(`m_${gCounter}_a`, `user_others_${gCounter}`, gameId, "OTHERS");
		}

		// Physical Match 1: D01 vs D02, D01 first and wins 2-1
		const gId1 = "b0000000-0000-4000-8000-000000000001";
		await seedMatch("m_spec_1_a", "hero_player_1", gId1, "D01", {
			playerName: "hero",
			opponentName: "agent",
			playerScore: 2,
			opponentScore: 1,
			winner: true,
		});
		await seedMatch("m_spec_1_b", "agent_player_2", gId1, "D02", {
			playerName: "agent",
			opponentName: "hero",
			playerScore: 1,
			opponentScore: 2,
			winner: false,
		});
		await seedDuel(
			"d_1_a",
			"hero_player_1",
			gId1,
			"c0000000-0000-4000-8000-000000000001",
			"m_spec_1_a",
			1,
			true,
		);
		await seedDuel(
			"d_1_b",
			"agent_player_2",
			gId1,
			"c0000000-0000-4000-8000-000000000002",
			"m_spec_1_b",
			1,
			false,
		);

		// Physical Match 2: D01 mirror, hero_mirror_A first and wins 2-0
		const gId2 = "b0000000-0000-4000-8000-000000000002";
		await seedMatch("m_spec_2_a", "hero_mirror_A", gId2, "D01", {
			playerName: "heroA",
			opponentName: "heroB",
			playerScore: 2,
			opponentScore: 0,
			winner: true,
		});
		await seedMatch("m_spec_2_b", "hero_mirror_B", gId2, "D01", {
			playerName: "heroB",
			opponentName: "heroA",
			playerScore: 0,
			opponentScore: 2,
			winner: false,
		});
		await seedDuel(
			"d_2_a",
			"hero_mirror_A",
			gId2,
			"c0000000-0000-4000-8000-000000000003",
			"m_spec_2_a",
			1,
			true,
		);
		await seedDuel(
			"d_2_b",
			"hero_mirror_B",
			gId2,
			"c0000000-0000-4000-8000-000000000004",
			"m_spec_2_b",
			1,
			false,
		);

		// Physical Match 3: D01 vs D18 (D18 is 18th and therefore NOT in Top 16)
		const gId3 = "b0000000-0000-4000-8000-000000000003";
		await seedMatch("m_spec_3_a", "hero_pk", gId3, "D01", {
			playerName: "hero",
			opponentName: "karakuri",
			playerScore: 2,
			opponentScore: 0,
			winner: true,
		});
		await seedMatch("m_spec_3_b", "karakuri_pk", gId3, "D18", {
			playerName: "karakuri",
			opponentName: "hero",
			playerScore: 0,
			opponentScore: 2,
			winner: false,
		});
		await seedDuel(
			"d_3_a",
			"hero_pk",
			gId3,
			"c0000000-0000-4000-8000-000000000005",
			"m_spec_3_a",
			1,
			true,
		);
		await seedDuel(
			"d_3_b",
			"karakuri_pk",
			gId3,
			"c0000000-0000-4000-8000-000000000006",
			"m_spec_3_b",
			1,
			false,
		);

		// Execute rebuild
		const window = HalfYearWindow.fromPeriodString(period, "2026-08-20");
		const rebuildResult = await rebuildUseCase.rebuildFormatWindow("1109", window);

		expect(rebuildResult.success).toBe(true);
		expect(rebuildResult.formatId).toBe("1109");
		expect(rebuildResult.windowStart).toBe(window.windowStart);
		// Admitted physical matches are exactly 2: D01 vs D02 and the D01 mirror.
		// Match 3 is excluded because D18 is 18th (not in Top 16).
		expect(rebuildResult.admittedPhysicalMatches).toBe(2);

		// Verify database table stats_deck_matchups and checksum
		const matchupRows: { match_count: number }[] = await ds.query(`
			SELECT match_count FROM stats_deck_matchups
			WHERE format_id = '1109' AND window_start = '${rebuildResult.windowStart}'::date
		`);
		const sumMatchCount = matchupRows.reduce((acc, r) => acc + Number(r.match_count), 0);
		expect(sumMatchCount).toBe(2);

		// Query via GetDeckMatchupStatsUseCase
		const statsRes = await getStatsUseCase.execute({
			format: "1109",
			period,
		});

		expect(statsRes.format).toBe("1109");
		expect(statsRes.period).toBe(period);
		expect(statsRes.totalPhysicalMatches).toBe(2);
		expect(statsRes.decks).toHaveLength(16);

		// Verify Top 16 does NOT contain OTHERS or D18, but keeps the 16th deck D16
		const deckCodes = statsRes.decks.map((d) => d.code);
		expect(deckCodes).not.toContain("OTHERS");
		expect(deckCodes).not.toContain("D18");
		expect(deckCodes).toContain("D16");
		expect(deckCodes).toContain("D01");
		expect(deckCodes).toContain("D02");

		// Verify D01 vs D02 stats (D01 went first and won the Match)
		const d01VsD02 = statsRes.stats["D01::D02"];
		expect(d01VsD02).toEqual({
			matches: 1,
			matchWins: 1,
			firstMatches: 1,
			firstWins: 1,
			secondMatches: 0,
			secondWins: 0,
		});

		// Verify D02 vs D01 stats (opposite perspective)
		const d02VsD01 = statsRes.stats["D02::D01"];
		expect(d02VsD01).toEqual({
			matches: 1,
			matchWins: 0,
			firstMatches: 0,
			firstWins: 0,
			secondMatches: 1,
			secondWins: 0,
		});

		// Verify D01 mirror stats (overall = 1 win out of 2 player matches, first=1/1, second=0/1)
		const d01Mirror = statsRes.stats["D01::D01"];
		expect(d01Mirror).toEqual({
			matches: 2,
			matchWins: 1,
			firstMatches: 1,
			firstWins: 1,
			secondMatches: 1,
			secondWins: 0,
		});
	});
});
