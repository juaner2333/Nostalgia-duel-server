import { ReplayDeckBackfillService } from "./ReplayDeckBackfillService";
import { MatchDeckRepository } from "../../domain/MatchDeckRepository";
import { DownloadMatchDeck } from "../DownloadMatchDeck";
import { DuelRecordMother } from "@test-support/mothers/room/DuelRecordMother";
import YGOProDeck from "ygopro-deck-encode";

describe("ReplayDeckBackfillIntegration (Task 7.6)", () => {
	// In-memory simulated PostgreSQL store for backfill rehearsal
	let matchesTable: any[] = [];
	let replaysTable: any[] = [];
	let matchDecksTable: any[] = [];

	const mockDbClient = {
		async query(sql: string, params: any[] = []) {
			const normalized = sql.replace(/\s+/g, " ").trim();

			// 1. SELECT DISTINCT m.game_id AS "gameId" FROM matches m WHERE m.format_id = $1 ...
			if (normalized.includes('SELECT DISTINCT m.game_id AS "gameId"')) {
				const formatId = params[0];
				const cursor = normalized.includes("AND m.game_id > $2") ? params[1] : undefined;
				const limit = normalized.includes("AND m.game_id > $2") ? params[2] : params[1];
				let distinctGames = Array.from(
					new Set(
						matchesTable
							.filter((m) => m.format_id === formatId && !m.anulled && !m.deleted_at)
							.map((m) => m.game_id),
					),
				).sort();
				if (cursor) {
					distinctGames = distinctGames.filter((g) => g > cursor);
				}
				if (typeof limit === "number") {
					distinctGames = distinctGames.slice(0, limit);
				}
				return distinctGames.map((g) => ({ gameId: g }));
			}

			// 2. Transaction commands
			if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
				return { rowCount: 0 };
			}

			// 2. Check online snapshot
			if (normalized.includes("snapshot_source = 'online'")) {
				const gameId = params[0];
				const formatId = params[1];
				const matchIds = matchesTable
					.filter((m) => m.game_id === gameId && m.format_id === formatId)
					.map((m) => m.id);
				const onlineDecks = matchDecksTable.filter(
					(md) => matchIds.includes(md.match_id) && md.snapshot_source === "online",
				);
				return onlineDecks.length > 0 ? [{ exists: 1 }] : [];
			}

			// 3. Check already backfilled count
			if (normalized.includes("count(md.match_id)::int AS count")) {
				const gameId = params[0];
				const formatId = params[1];
				const matchIds = matchesTable
					.filter((m) => m.game_id === gameId && m.format_id === formatId)
					.map((m) => m.id);
				const count = matchDecksTable.filter((md) => matchIds.includes(md.match_id)).length;
				return [{ count }];
			}

			// 4. Query match perspectives
			if (normalized.includes('SELECT m.id, m.user_id AS "userId"')) {
				const gameId = params[0];
				const formatId = params[1];
				return matchesTable
					.filter(
						(m) => m.game_id === gameId && m.format_id === formatId && !m.anulled && !m.deleted_at,
					)
					.map((m) => ({
						id: m.id,
						userId: m.userId,
						playerNames: m.player_names,
						opponentNames: m.opponent_names,
						formatId: m.format_id,
					}));
			}

			// 5. Query G1 replay
			if (
				normalized.includes(
					"FROM duel_replays dr WHERE dr.game_id = $1 AND dr.format_id = $2 AND dr.duel_index = 1",
				)
			) {
				const gameId = params[0];
				const formatId = params[1];
				return replaysTable
					.filter((r) => r.game_id === gameId && r.format_id === formatId && r.duel_index === 1)
					.map((r) => ({
						id: r.id,
						replayData: r.replay_data,
					}));
			}

			// 6. INSERT INTO match_decks
			if (normalized.includes("INSERT INTO match_decks")) {
				const [
					match_id,
					format_id,
					deck_type_code,
					classifier_version,
					snapshot_source,
					main_cards,
					extra_cards,
					side_cards,
				] = params;

				const existingIndex = matchDecksTable.findIndex((md) => md.match_id === match_id);
				if (existingIndex < 0) {
					matchDecksTable.push({
						match_id,
						format_id,
						deck_type_code,
						classifier_version,
						snapshot_source,
						main_cards,
						extra_cards,
						side_cards,
					});
				}
				return { rowCount: 1 };
			}

			throw new Error("Unhandled SQL query: " + sql);
		},
	};

	function buildG1Replay(
		hostName: string,
		clientName: string,
		hostMain: number[],
		clientMain: number[],
	): Buffer {
		const record = DuelRecordMother.create({
			players: [
				{
					name: hostName,
					deck: new YGOProDeck({ main: hostMain, extra: [83764718], side: [] }),
				},
				{
					name: clientName,
					deck: new YGOProDeck({ main: clientMain, extra: [], side: [] }),
				},
			],
		});
		const mockRoom = {
			hostInfo: {
				start_lp: 8000,
				start_hand: 5,
				draw_count: 1,
				rule: 2,
				mode: 1,
				duel_rule: 2,
				no_check_deck: 0,
				no_shuffle_deck: 0,
				best_of: 3,
				max_deck_points: 0,
				lflist: 0,
				time_limit: 180,
			},
			isTag: false,
		};
		return Buffer.from(record.toYrp(mockRoom).toYrp());
	}

	beforeEach(() => {
		matchesTable = [];
		replaysTable = [];
		matchDecksTable = [];

		// Seed 1103 match (40x Dark Magician vs 40x Blue-Eyes)
		const game1103 = "game-1103-01";
		matchesTable.push(
			{
				id: "m-1103-p1",
				userId: "u-1",
				game_id: game1103,
				format_id: "1103",
				player_names: "Yugi",
				opponent_names: "Kaiba",
				anulled: false,
				deleted_at: null,
			},
			{
				id: "m-1103-p2",
				userId: "u-2",
				game_id: game1103,
				format_id: "1103",
				player_names: "Kaiba",
				opponent_names: "Yugi",
				anulled: false,
				deleted_at: null,
			},
		);
		replaysTable.push({
			id: "r-1103-g1",
			game_id: game1103,
			format_id: "1103",
			duel_index: 1,
			replay_data: buildG1Replay(
				"Yugi",
				"Kaiba",
				new Array(40).fill(46986414),
				new Array(40).fill(89631139),
			),
		});

		// Seed 1109 match (Agent Angel D01 vs HB D02)
		const game1109 = "game-1109-01";
		// D01 Agent cards: [91188343, 55794644, 64734921] + 37x filler
		const agentMain = [91188343, 55794644, 64734921, ...new Array(37).fill(33398782)];
		// D02 HB cards: [69884162, 69884162, 33846209, 33846209, 37412656] + 35x filler
		const hbMain = [
			69884162,
			69884162,
			33846209,
			33846209,
			37412656,
			...new Array(35).fill(33398782),
		];

		matchesTable.push(
			{
				id: "m-1109-p1",
				userId: "u-3",
				game_id: game1109,
				format_id: "1109",
				player_names: "AgentPlayer",
				opponent_names: "HeroPlayer",
				anulled: false,
				deleted_at: null,
			},
			{
				id: "m-1109-p2",
				userId: "u-4",
				game_id: game1109,
				format_id: "1109",
				player_names: "HeroPlayer",
				opponent_names: "AgentPlayer",
				anulled: false,
				deleted_at: null,
			},
		);
		replaysTable.push({
			id: "r-1109-g1",
			game_id: game1109,
			format_id: "1109",
			duel_index: 1,
			replay_data: buildG1Replay("AgentPlayer", "HeroPlayer", agentMain, hbMain),
		});
	});

	it("rehearses full dry-run and execution backfill cycle across 1103 and 1109", async () => {
		const service = new ReplayDeckBackfillService(mockDbClient, mockDbClient);

		// Step 1: Dry run for 1103 and 1109
		const dryRun1103 = await service.run({ formatId: "1103", dryRun: true });
		expect(dryRun1103.candidates).toBe(1);
		expect(dryRun1103.successful).toBe(1);
		expect(matchDecksTable).toHaveLength(0); // ZERO database writes

		const dryRun1109 = await service.run({ formatId: "1109", dryRun: true });
		expect(dryRun1109.candidates).toBe(1);
		expect(dryRun1109.successful).toBe(1);
		expect(matchDecksTable).toHaveLength(0); // ZERO database writes

		// Step 2: Execute backfill for 1103
		const exec1103 = await service.run({ formatId: "1103", dryRun: false });
		expect(exec1103.successful).toBe(1);
		expect(matchDecksTable).toHaveLength(2);

		const p1Deck1103 = matchDecksTable.find((md) => md.match_id === "m-1103-p1");
		const p2Deck1103 = matchDecksTable.find((md) => md.match_id === "m-1103-p2");
		expect(p1Deck1103.deck_type_code).toBe("OTHERS");
		expect(p2Deck1103.deck_type_code).toBe("OTHERS");
		expect(p1Deck1103.snapshot_source).toBe("replay_backfill");
		expect(p1Deck1103.side_cards).toBeNull();

		// Step 3: Execute backfill for 1109
		const exec1109 = await service.run({ formatId: "1109", dryRun: false });
		expect(exec1109.successful).toBe(1);
		expect(matchDecksTable).toHaveLength(4);

		const p1Deck1109 = matchDecksTable.find((md) => md.match_id === "m-1109-p1");
		const p2Deck1109 = matchDecksTable.find((md) => md.match_id === "m-1109-p2");
		expect(p1Deck1109.deck_type_code).toBe("D01"); // Agent Angel
		expect(p2Deck1109.deck_type_code).toBe("D02"); // HB
		expect(p1Deck1109.snapshot_source).toBe("replay_backfill");
		expect(p1Deck1109.side_cards).toBeNull();

		// Step 4: Verify YDK download produces partial header and ydk format
		const mockMatchDeckRepo: MatchDeckRepository = {
			async findByMatchId(formatId, matchId) {
				const md = matchDecksTable.find((m) => m.format_id === formatId && m.match_id === matchId);
				if (!md) return null;
				const match = matchesTable.find((m) => m.id === matchId);
				return {
					matchId: md.match_id,
					formatId: md.format_id,
					date: new Date("2026-09-02T12:00:00Z"),
					playerName: match.player_names,
					opponentName: match.opponent_names,
					mainCards: md.main_cards,
					extraCards: md.extra_cards,
					sideCards: md.side_cards,
					completeness: "partial",
				};
			},
		};

		const downloadUseCase = new DownloadMatchDeck(mockMatchDeckRepo);
		const downloadResult = await downloadUseCase.run({
			format: "1109",
			matchId: "m-1109-p1",
		});
		expect(downloadResult.completeness).toBe("partial");
		expect(downloadResult.filename).toContain("(partial).ydk");
		expect(downloadResult.ydkContent).toContain("#main\r\n");
		expect(downloadResult.ydkContent).toContain("!side\r\n");

		// Step 5: Idempotent rerun - no duplicate rows, marked as alreadyBackfilled
		const rerun = await service.run({ formatId: "1109", dryRun: false });
		expect(rerun.skipped.alreadyBackfilled).toBe(1);
		expect(rerun.successful).toBe(0);
		expect(matchDecksTable).toHaveLength(4); // No duplicates
	});
});
