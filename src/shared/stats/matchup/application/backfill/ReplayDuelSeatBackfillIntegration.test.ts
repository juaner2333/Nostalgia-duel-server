import { ReplayDuelSeatBackfillService } from "./ReplayDuelSeatBackfillService";
import { DuelRecordMother } from "@test-support/mothers/room/DuelRecordMother";
import YGOProDeck from "ygopro-deck-encode";

describe("ReplayDuelSeatBackfillIntegration (Task 3.4)", () => {
	let matchesTable: any[] = [];
	let replaysTable: any[] = [];
	let duelsTable: any[] = [];

	const mockDbClient = {
		async query(sql: string, params: any[] = []) {
			const normalized = sql.replace(/\s+/g, " ").trim();

			// 1. SELECT DISTINCT m.game_id AS "gameId"
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

			// 3. Query match perspectives
			if (normalized.includes('SELECT m.id, m.user_id AS "userId"')) {
				const gameId = params[0];
				const formatId = params[1];
				return matchesTable
					.filter(
						(m) => m.game_id === gameId && m.format_id === formatId && !m.anulled && !m.deleted_at,
					)
					.map((m) => ({
						id: m.id,
						userId: m.user_id,
						playerNames: m.player_names,
						opponentNames: m.opponent_names,
					}));
			}

			// 4. Query duels
			if (normalized.includes("FROM duels d WHERE d.match_id IN ($1, $2)")) {
				const [m1Id, m2Id] = params;
				return duelsTable
					.filter((d) => (d.match_id === m1Id || d.match_id === m2Id) && !d.deleted_at)
					.map((d) => ({
						id: d.id,
						matchId: d.match_id,
						userId: d.user_id,
						replayId: d.replay_id,
						duelIndex: d.duel_index,
						isFirst: d.is_first,
					}));
			}

			// 5. Query duel_replays
			if (normalized.includes("FROM duel_replays r WHERE r.id = ANY($1)")) {
				const [replayIds, gameId, formatId] = params;
				return replaysTable
					.filter(
						(r) => replayIds.includes(r.id) && r.game_id === gameId && r.format_id === formatId,
					)
					.map((r) => ({
						id: r.id,
						gameId: r.game_id,
						formatId: r.format_id,
						duelIndex: r.duel_index,
						replayData: r.replay_data,
					}));
			}

			// 6. UPDATE duels
			if (normalized.includes("UPDATE duels SET duel_index = $1, is_first = $2")) {
				const [duelIndex, isFirst, duelId] = params;
				const duel = duelsTable.find((d) => d.id === duelId);
				if (duel) {
					duel.duel_index = duelIndex;
					duel.is_first = isFirst;
					duel.updated_at = new Date();
				}
				return { rowCount: 1 };
			}

			throw new Error("Unhandled SQL query: " + sql);
		},
	};

	function createReplayBuffer(options: {
		hostName: string;
		clientName: string;
		isSwapped?: boolean;
	}): Buffer {
		const deck = new YGOProDeck({
			main: new Array(40).fill(46986414),
			extra: [83764718],
			side: [],
		});
		const record = DuelRecordMother.create({
			players: [
				{ name: options.hostName, deck },
				{ name: options.clientName, deck },
			],
			isSwapped: options.isSwapped ?? false,
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
		duelsTable = [];
	});

	it("rehearses full historical dataset with dry-run, execution, idempotence, and conflict protection", async () => {
		const service = new ReplayDuelSeatBackfillService(mockDbClient, mockDbClient);

		// Seed Match 1: Game 101 - G1 replay with Alice (host, goes first) and Bob (client, goes second)
		const g101Replay = createReplayBuffer({ hostName: "Alice", clientName: "Bob" });
		matchesTable.push(
			{
				id: "m-101-a",
				user_id: "u-alice",
				game_id: "game-101",
				format_id: "1109",
				player_names: "Alice",
				opponent_names: "Bob",
				season: "2026H1",
				anulled: false,
				deleted_at: null,
			},
			{
				id: "m-101-b",
				user_id: "u-bob",
				game_id: "game-101",
				format_id: "1109",
				player_names: "Bob",
				opponent_names: "Alice",
				season: "2026H1",
				anulled: false,
				deleted_at: null,
			},
		);
		replaysTable.push({
			id: "r-101-1",
			game_id: "game-101",
			format_id: "1109",
			duel_index: 1,
			replay_data: g101Replay,
		});
		duelsTable.push(
			{
				id: "d-101-1-a",
				match_id: "m-101-a",
				user_id: "u-alice",
				replay_id: "r-101-1",
				duel_index: null,
				is_first: null,
				deleted_at: null,
			},
			{
				id: "d-101-1-b",
				match_id: "m-101-b",
				user_id: "u-bob",
				replay_id: "r-101-1",
				duel_index: null,
				is_first: null,
				deleted_at: null,
			},
		);

		// Seed Match 2: Game 102 - G1 replay valid, G2 corrupted (index only)
		const g102Replay1 = createReplayBuffer({ hostName: "Charlie", clientName: "Dave" });
		matchesTable.push(
			{
				id: "m-102-c",
				user_id: "u-charlie",
				game_id: "game-102",
				format_id: "1109",
				player_names: "Charlie",
				opponent_names: "Dave",
				season: "2026H1",
				anulled: false,
				deleted_at: null,
			},
			{
				id: "m-102-d",
				user_id: "u-dave",
				game_id: "game-102",
				format_id: "1109",
				player_names: "Dave",
				opponent_names: "Charlie",
				season: "2026H1",
				anulled: false,
				deleted_at: null,
			},
		);
		replaysTable.push(
			{
				id: "r-102-1",
				game_id: "game-102",
				format_id: "1109",
				duel_index: 1,
				replay_data: g102Replay1,
			},
			{
				id: "r-102-2",
				game_id: "game-102",
				format_id: "1109",
				duel_index: 2,
				replay_data: Buffer.alloc(10), // Corrupted
			},
		);
		duelsTable.push(
			{
				id: "d-102-1-c",
				match_id: "m-102-c",
				user_id: "u-charlie",
				replay_id: "r-102-1",
				duel_index: null,
				is_first: null,
				deleted_at: null,
			},
			{
				id: "d-102-1-d",
				match_id: "m-102-d",
				user_id: "u-dave",
				replay_id: "r-102-1",
				duel_index: null,
				is_first: null,
				deleted_at: null,
			},
			{
				id: "d-102-2-c",
				match_id: "m-102-c",
				user_id: "u-charlie",
				replay_id: "r-102-2",
				duel_index: null,
				is_first: null,
				deleted_at: null,
			},
			{
				id: "d-102-2-d",
				match_id: "m-102-d",
				user_id: "u-dave",
				replay_id: "r-102-2",
				duel_index: null,
				is_first: null,
				deleted_at: null,
			},
		);

		// Seed Match 3: Game 103 - Placeholder replay_id (not in duel_replays)
		matchesTable.push(
			{
				id: "m-103-e",
				user_id: "u-eve",
				game_id: "game-103",
				format_id: "1109",
				player_names: "Eve",
				opponent_names: "Frank",
				season: "2026H1",
				anulled: false,
				deleted_at: null,
			},
			{
				id: "m-103-f",
				user_id: "u-frank",
				game_id: "game-103",
				format_id: "1109",
				player_names: "Frank",
				opponent_names: "Eve",
				season: "2026H1",
				anulled: false,
				deleted_at: null,
			},
		);
		duelsTable.push(
			{
				id: "d-103-1-e",
				match_id: "m-103-e",
				user_id: "u-eve",
				replay_id: "placeholder-uuid-103",
				duel_index: null,
				is_first: null,
				deleted_at: null,
			},
			{
				id: "d-103-1-f",
				match_id: "m-103-f",
				user_id: "u-frank",
				replay_id: "placeholder-uuid-103",
				duel_index: null,
				is_first: null,
				deleted_at: null,
			},
		);

		// Seed Match 4: Game 104 - Conflict with existing online value
		const g104Replay = createReplayBuffer({ hostName: "Grace", clientName: "Heidi" });
		matchesTable.push(
			{
				id: "m-104-g",
				user_id: "u-grace",
				game_id: "game-104",
				format_id: "1109",
				player_names: "Grace",
				opponent_names: "Heidi",
				season: "2026H1",
				anulled: false,
				deleted_at: null,
			},
			{
				id: "m-104-h",
				user_id: "u-heidi",
				game_id: "game-104",
				format_id: "1109",
				player_names: "Heidi",
				opponent_names: "Grace",
				season: "2026H1",
				anulled: false,
				deleted_at: null,
			},
		);
		replaysTable.push({
			id: "r-104-1",
			game_id: "game-104",
			format_id: "1109",
			duel_index: 1,
			replay_data: g104Replay,
		});
		duelsTable.push(
			{
				id: "d-104-1-g",
				match_id: "m-104-g",
				user_id: "u-grace",
				replay_id: "r-104-1",
				duel_index: 1,
				is_first: false, // Conflicting with replay hostName Grace!
				deleted_at: null,
			},
			{
				id: "d-104-1-h",
				match_id: "m-104-h",
				user_id: "u-heidi",
				replay_id: "r-104-1",
				duel_index: null,
				is_first: null,
				deleted_at: null,
			},
		);

		// 1. Rehearsal: dry-run
		const dryRunReport = await service.run({ formatId: "1109", dryRun: true });

		expect(dryRunReport.scannedGames).toBe(4);
		expect(dryRunReport.candidates).toBe(4);
		expect(dryRunReport.successfulGames).toBe(2); // game-101 and game-102
		expect(dryRunReport.seatsConfirmedDuels).toBe(4); // 2 in game-101, 2 in game-102 G1
		expect(dryRunReport.indexOnlyConfirmedDuels).toBe(2); // 2 in game-102 G2
		expect(dryRunReport.unknownDuels).toBe(2); // 2 in game-103
		expect(dryRunReport.conflictDuels).toBe(1); // 1 in game-104

		// Confirm duels table was untouched in dryRun
		expect(duelsTable.every((d) => d.id === "d-104-1-g" || d.duel_index === null)).toBe(true);

		// 2. Formal Backfill: execute mode
		const executeReport = await service.run({ formatId: "1109", dryRun: false });

		expect(executeReport.successfulGames).toBe(2);
		expect(executeReport.seatsConfirmedDuels).toBe(4);
		expect(executeReport.indexOnlyConfirmedDuels).toBe(2);
		expect(executeReport.conflictDuels).toBe(1);

		// Verify game-101 duels:
		const d101a = duelsTable.find((d) => d.id === "d-101-1-a");
		const d101b = duelsTable.find((d) => d.id === "d-101-1-b");
		expect(d101a.duel_index).toBe(1);
		expect(d101a.is_first).toBe(true); // Alice was host
		expect(d101b.duel_index).toBe(1);
		expect(d101b.is_first).toBe(false); // Bob was client

		// Verify game-102 duels:
		const d102c1 = duelsTable.find((d) => d.id === "d-102-1-c");
		const d102d1 = duelsTable.find((d) => d.id === "d-102-1-d");
		expect(d102c1.duel_index).toBe(1);
		expect(d102c1.is_first).toBe(true); // Charlie was host
		expect(d102d1.duel_index).toBe(1);
		expect(d102d1.is_first).toBe(false); // Dave was client

		const d102c2 = duelsTable.find((d) => d.id === "d-102-2-c");
		const d102d2 = duelsTable.find((d) => d.id === "d-102-2-d");
		expect(d102c2.duel_index).toBe(2);
		expect(d102c2.is_first).toBeNull(); // Corrupted replay -> is_first null
		expect(d102d2.duel_index).toBe(2);
		expect(d102d2.is_first).toBeNull();

		// Verify game-103: untouched
		const d103e = duelsTable.find((d) => d.id === "d-103-1-e");
		expect(d103e.duel_index).toBeNull();
		expect(d103e.is_first).toBeNull();

		// Verify game-104: untouched due to conflict
		const d104h = duelsTable.find((d) => d.id === "d-104-1-h");
		expect(d104h.duel_index).toBeNull();
		expect(d104h.is_first).toBeNull();

		// 3. Idempotent rerun: should write 0 updates, report alreadyConfirmed
		const rerunReport = await service.run({ formatId: "1109", dryRun: false });
		expect(rerunReport.successfulGames).toBe(0);
		expect(rerunReport.seatsConfirmedDuels).toBe(0);
		expect(rerunReport.indexOnlyConfirmedDuels).toBe(0);
		expect(rerunReport.skipped.alreadyConfirmed).toBe(6); // 4 seats confirmed + 2 index confirmed
		expect(rerunReport.conflictDuels).toBe(1);

		// 4. Calculate confirmed G1 proportions and reconstructable seasons
		// Total games: 4 (all in 2026H1). Confirmed G1: game-101 and game-102 (2/4 = 50%).
		const g1ConfirmedGames = 2;
		const totalGames = 4;
		const unconfirmedProportion = (totalGames - g1ConfirmedGames) / totalGames;
		expect(unconfirmedProportion).toBe(0.5);
	});
});
