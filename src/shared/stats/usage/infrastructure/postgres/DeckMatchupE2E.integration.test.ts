import { DataSource } from "typeorm";
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
			repository = new UsageStatisticsPostgresRepository(ds);
			const metadataProvider = new CdbCardMetadataProvider();
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

	it("rebuilds 1109 deck statistics end-to-end, validates Top 15 consistency, checksum, and API retrieval", async () => {
		if (!isDbAvailable || !ds) return;

		const period = "2026H2"; // 2026-07-01 to 2027-01-01
		const matchDate = "2026-08-15 14:00:00";

		// 16 named deck types
		const testDecks = [
			"HERO",
			"AGENT",
			"DARK_WORLD",
			"SIX_SAMURAI",
			"CHAOS_DRAGON",
			"DRAGUNITY",
			"INZEKTOR",
			"WIND_UP",
			"GLADIATOR_BEAST",
			"LIGHTSWORN",
			"GRAVEKEEPER",
			"MACHINA_GADGET",
			"FROG_MONARCH",
			"T.G.",
			"BLACKWING",
			"KARAKURI", // 16th named deck
		];

		let gCounter = 100;

		// Seed matches for each deck so that HERO has most, KARAKURI has least, OTHERS also present
		for (let i = 0; i < testDecks.length; i++) {
			const deckCode = testDecks[i];
			const count = 20 - i; // HERO=20, ..., BLACKWING=6, KARAKURI=5
			for (let c = 0; c < count; c++) {
				gCounter++;
				const gameId = `a0000000-0000-4000-8000-${String(gCounter).padStart(12, "0")}`;
				const userA = `user_a_${gCounter}`;
				const userB = `user_b_${gCounter}`;
				const matchIdA = `m_${gCounter}_a`;
				const matchIdB = `m_${gCounter}_b`;

				// Insert match A
				await ds.query(`
					INSERT INTO matches (
						id, user_id, game_id, format_id, best_of, player_names, opponent_names,
						date, ban_list_name, ban_list_hash, player_score, opponent_score, winner, season, points
					) VALUES (
						'${matchIdA}', '${userA}', '${gameId}', '1109', 3, 'playerA', 'playerB',
						'${matchDate}'::timestamp, '1109.0', 'hash', 2, 0, true, 1, 100
					)
				`);

				// Insert match B
				await ds.query(`
					INSERT INTO matches (
						id, user_id, game_id, format_id, best_of, player_names, opponent_names,
						date, ban_list_name, ban_list_hash, player_score, opponent_score, winner, season, points
					) VALUES (
						'${matchIdB}', '${userB}', '${gameId}', '1109', 3, 'playerB', 'playerA',
						'${matchDate}'::timestamp, '1109.0', 'hash', 0, 2, false, 1, 0
					)
				`);

				// Insert deck A
				await ds.query(`
					INSERT INTO match_decks (
						match_id, game_id, user_id, format_id, deck_type_code, deck_type_name_zh,
						main_count, extra_count, side_count, main_card_ids, side_card_ids, extra_card_ids
					) VALUES (
						'${matchIdA}', '${gameId}', '${userA}', '1109', '${deckCode}', '${deckCode}',
						40, 15, 15, '10000000', '', ''
					)
				`);
			}
		}

		// Seed OTHERS deck matches
		for (let c = 0; c < 30; c++) {
			gCounter++;
			const gameId = `a0000000-0000-4000-8000-${String(gCounter).padStart(12, "0")}`;
			const userA = `user_others_${gCounter}`;
			const matchIdA = `m_${gCounter}_a`;

			await ds.query(`
				INSERT INTO matches (
					id, user_id, game_id, format_id, best_of, player_names, opponent_names,
					date, ban_list_name, ban_list_hash, player_score, opponent_score, winner, season, points
				) VALUES (
					'${matchIdA}', '${userA}', '${gameId}', '1109', 3, 'playerO', 'playerB',
					'${matchDate}'::timestamp, '1109.0', 'hash', 2, 0, true, 1, 100
				)
			`);

			await ds.query(`
				INSERT INTO match_decks (
					match_id, game_id, user_id, format_id, deck_type_code, deck_type_name_zh,
					main_count, extra_count, side_count, main_card_ids, side_card_ids, extra_card_ids
				) VALUES (
					'${matchIdA}', '${gameId}', '${userA}', '1109', 'OTHERS', '其他',
					40, 15, 15, '10000000', '', ''
				)
			`);
		}

		// Now seed 3 specific physical Matches between Top 15 decks with frozen G1 seats
		// Match 1: HERO vs AGENT (HERO first, HERO wins 2-1)
		const gId1 = "b0000000-0000-4000-8000-000000000001";
		const p1 = "hero_player_1";
		const p2 = "agent_player_2";
		const mId1A = "m_spec_1_a";
		const mId1B = "m_spec_1_b";

		await ds.query(`
			INSERT INTO matches (
				id, user_id, game_id, format_id, best_of, player_names, opponent_names,
				date, ban_list_name, ban_list_hash, player_score, opponent_score, winner, season, points
			) VALUES
				('${mId1A}', '${p1}', '${gId1}', '1109', 3, 'hero', 'agent', '${matchDate}'::timestamp, '1109.0', 'hash', 2, 1, true, 1, 100),
				('${mId1B}', '${p2}', '${gId1}', '1109', 3, 'agent', 'hero', '${matchDate}'::timestamp, '1109.0', 'hash', 1, 2, false, 1, 0)
		`);

		await ds.query(`
			INSERT INTO match_decks (
				match_id, game_id, user_id, format_id, deck_type_code, deck_type_name_zh,
				main_count, extra_count, side_count, main_card_ids, side_card_ids, extra_card_ids
			) VALUES
				('${mId1A}', '${gId1}', '${p1}', '1109', 'HERO', '英雄', 40, 15, 15, '10000000', '', ''),
				('${mId1B}', '${gId1}', '${p2}', '1109', 'AGENT', '代行者', 40, 15, 15, '10000000', '', '')
		`);

		const repId1A = "c0000000-0000-4000-8000-000000000001";
		const repId1B = "c0000000-0000-4000-8000-000000000002";
		await ds.query(`
			INSERT INTO duels (
				id, user_id, game_id, replay_id, match_id, player_names, opponent_names,
				date, ban_list_name, ban_list_hash, player_score, opponent_score, winner,
				duel_index, is_first
			) VALUES
				('d_1_a', '${p1}', '${gId1}', '${repId1A}', '${mId1A}', 'hero', 'agent', '${matchDate}'::timestamp, '1109.0', 'hash', 1, 0, true, 1, true),
				('d_1_b', '${p2}', '${gId1}', '${repId1B}', '${mId1B}', 'agent', 'hero', '${matchDate}'::timestamp, '1109.0', 'hash', 0, 1, false, 1, false)
		`);

		// Match 2: HERO vs HERO mirror match (pHeroA first, pHeroA wins 2-0)
		const gId2 = "b0000000-0000-4000-8000-000000000002";
		const pHeroA = "hero_mirror_A";
		const pHeroB = "hero_mirror_B";
		const mId2A = "m_spec_2_a";
		const mId2B = "m_spec_2_b";

		await ds.query(`
			INSERT INTO matches (
				id, user_id, game_id, format_id, best_of, player_names, opponent_names,
				date, ban_list_name, ban_list_hash, player_score, opponent_score, winner, season, points
			) VALUES
				('${mId2A}', '${pHeroA}', '${gId2}', '1109', 3, 'heroA', 'heroB', '${matchDate}'::timestamp, '1109.0', 'hash', 2, 0, true, 1, 100),
				('${mId2B}', '${pHeroB}', '${gId2}', '1109', 3, 'heroB', 'heroA', '${matchDate}'::timestamp, '1109.0', 'hash', 0, 2, false, 1, 0)
		`);

		await ds.query(`
			INSERT INTO match_decks (
				match_id, game_id, user_id, format_id, deck_type_code, deck_type_name_zh,
				main_count, extra_count, side_count, main_card_ids, side_card_ids, extra_card_ids
			) VALUES
				('${mId2A}', '${gId2}', '${pHeroA}', '1109', 'HERO', '英雄', 40, 15, 15, '10000000', '', ''),
				('${mId2B}', '${gId2}', '${pHeroB}', '1109', 'HERO', '英雄', 40, 15, 15, '10000000', '', '')
		`);

		const repId2A = "c0000000-0000-4000-8000-000000000003";
		const repId2B = "c0000000-0000-4000-8000-000000000004";
		await ds.query(`
			INSERT INTO duels (
				id, user_id, game_id, replay_id, match_id, player_names, opponent_names,
				date, ban_list_name, ban_list_hash, player_score, opponent_score, winner,
				duel_index, is_first
			) VALUES
				('d_2_a', '${pHeroA}', '${gId2}', '${repId2A}', '${mId2A}', 'heroA', 'heroB', '${matchDate}'::timestamp, '1109.0', 'hash', 1, 0, true, 1, true),
				('d_2_b', '${pHeroB}', '${gId2}', '${repId2B}', '${mId2B}', 'heroB', 'heroA', '${matchDate}'::timestamp, '1109.0', 'hash', 0, 1, false, 1, false)
		`);

		// Match 3: HERO vs KARAKURI (KARAKURI is 16th, so NOT in Top 15!)
		const gId3 = "b0000000-0000-4000-8000-000000000003";
		const pK1 = "hero_pk";
		const pK2 = "karakuri_pk";
		const mId3A = "m_spec_3_a";
		const mId3B = "m_spec_3_b";

		await ds.query(`
			INSERT INTO matches (
				id, user_id, game_id, format_id, best_of, player_names, opponent_names,
				date, ban_list_name, ban_list_hash, player_score, opponent_score, winner, season, points
			) VALUES
				('${mId3A}', '${pK1}', '${gId3}', '1109', 3, 'hero', 'karakuri', '${matchDate}'::timestamp, '1109.0', 'hash', 2, 0, true, 1, 100),
				('${mId3B}', '${pK2}', '${gId3}', '1109', 3, 'karakuri', 'hero', '${matchDate}'::timestamp, '1109.0', 'hash', 0, 2, false, 1, 0)
		`);

		await ds.query(`
			INSERT INTO match_decks (
				match_id, game_id, user_id, format_id, deck_type_code, deck_type_name_zh,
				main_count, extra_count, side_count, main_card_ids, side_card_ids, extra_card_ids
			) VALUES
				('${mId3A}', '${gId3}', '${pK1}', '1109', 'HERO', '英雄', 40, 15, 15, '10000000', '', ''),
				('${mId3B}', '${gId3}', '${pK2}', '1109', 'KARAKURI', '机巧', 40, 15, 15, '10000000', '', '')
		`);

		const repId3A = "c0000000-0000-4000-8000-000000000005";
		const repId3B = "c0000000-0000-4000-8000-000000000006";
		await ds.query(`
			INSERT INTO duels (
				id, user_id, game_id, replay_id, match_id, player_names, opponent_names,
				date, ban_list_name, ban_list_hash, player_score, opponent_score, winner,
				duel_index, is_first
			) VALUES
				('d_3_a', '${pK1}', '${gId3}', '${repId3A}', '${mId3A}', 'hero', 'karakuri', '${matchDate}'::timestamp, '1109.0', 'hash', 1, 0, true, 1, true),
				('d_3_b', '${pK2}', '${gId3}', '${repId3B}', '${mId3B}', 'karakuri', 'hero', '${matchDate}'::timestamp, '1109.0', 'hash', 0, 1, false, 1, false)
		`);

		// Execute rebuild
		const window = HalfYearWindow.fromPeriodString(period, "2026-08-20");
		const rebuildResult = await rebuildUseCase.rebuildFormatWindow("1109", window);

		expect(rebuildResult.success).toBe(true);
		expect(rebuildResult.formatId).toBe("1109");
		expect(rebuildResult.windowStart).toBe(window.windowStart);
		// Admitted physical matches should be exactly 2 (Match 1 HERO vs AGENT and Match 2 HERO vs HERO mirror)
		// Match 3 is excluded because KARAKURI is 16th (not in top 15)!
		expect(rebuildResult.admittedPhysicalMatches).toBe(2);

		// Verify database table stats_deck_matchups
		const matchupRows: { match_count: number }[] = await ds.query(`
			SELECT match_count FROM stats_deck_matchups
			WHERE format_id = '1109' AND window_start = '${rebuildResult.windowStart}'::date
		`);

		// Checksum: sum of match_count in stats_deck_matchups must equal admittedMatches
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
		expect(statsRes.decks).toHaveLength(15);

		// Verify Top 15 does NOT contain OTHERS or KARAKURI
		const deckCodes = statsRes.decks.map((d) => d.code);
		expect(deckCodes).not.toContain("OTHERS");
		expect(deckCodes).not.toContain("KARAKURI");
		expect(deckCodes).toContain("HERO");
		expect(deckCodes).toContain("AGENT");

		// Verify HERO vs AGENT stats
		// HERO went first and won Match
		const heroVsAgent = statsRes.stats["HERO_AGENT"];
		expect(heroVsAgent).toEqual({
			matches: 1,
			matchWins: 1,
			firstMatches: 1,
			firstWins: 1,
			secondMatches: 0,
			secondWins: 0,
		});

		// AGENT vs HERO stats (opposite perspective)
		const agentVsHero = statsRes.stats["AGENT_HERO"];
		expect(agentVsHero).toEqual({
			matches: 1,
			matchWins: 0,
			firstMatches: 0,
			firstWins: 0,
			secondMatches: 1,
			secondWins: 0,
		});

		// HERO vs HERO mirror stats (overall = 1 win out of 2 player matches, first=1/1, second=0/1)
		const heroVsHero = statsRes.stats["HERO_HERO"];
		expect(heroVsHero).toEqual({
			matches: 2,
			matchWins: 1,
			firstMatches: 1,
			firstWins: 1,
			secondMatches: 1,
			secondWins: 0,
		});
	});
});
