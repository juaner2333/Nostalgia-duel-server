import {
	ReplayDuelSeatBackfillService,
	verifyDuelSeatConnectionPermissions,
} from "./ReplayDuelSeatBackfillService";
import { DuelRecordMother } from "@test-support/mothers/room/DuelRecordMother";
import YGOProDeck from "ygopro-deck-encode";

const pgRows = <T>(rows: T[]) => ({ rows, rowCount: rows.length });

describe("ReplayDuelSeatBackfillService (Tasks 3.2 & 3.3)", () => {
	function createReplayBytes(options: {
		hostName: string;
		clientName: string;
		isSwapped?: boolean;
	}): Buffer {
		const defaultDeck = new YGOProDeck({
			main: new Array(40).fill(46986414),
			extra: [83764718],
			side: [],
		});

		const record = DuelRecordMother.create({
			players: [
				{ name: options.hostName, deck: defaultDeck },
				{ name: options.clientName, deck: defaultDeck },
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

	describe("Permission Verification", () => {
		it("checks SELECT on matches for readonly and UPDATE on duels for write", async () => {
			const mockRead = {
				query: jest.fn().mockResolvedValue(pgRows([{ can_select: true }])),
			};
			const mockWrite = {
				query: jest.fn().mockResolvedValue(pgRows([{ can_update: true }])),
			};

			const passRes = await verifyDuelSeatConnectionPermissions(mockRead, mockWrite, true);
			expect(passRes.valid).toBe(true);

			// Write permission failure
			mockWrite.query.mockResolvedValueOnce(pgRows([{ can_update: false }]));
			const failWrite = await verifyDuelSeatConnectionPermissions(mockRead, mockWrite, true);
			expect(failWrite.valid).toBe(false);
			expect(failWrite.error).toContain("WRITE user does not have UPDATE privilege on duels");

			// Read permission failure
			mockRead.query.mockResolvedValueOnce(pgRows([{ can_select: false }]));
			const failRead = await verifyDuelSeatConnectionPermissions(mockRead, mockWrite, false);
			expect(failRead.valid).toBe(false);
			expect(failRead.error).toContain("READONLY user does not have SELECT privilege on matches");
		});
	});

	describe("Backfill Service Execution", () => {
		let mockReadQuery: jest.Mock;
		let mockWriteQuery: jest.Mock;
		let service: ReplayDuelSeatBackfillService;

		beforeEach(() => {
			mockReadQuery = jest.fn();
			mockWriteQuery = jest.fn();
			service = new ReplayDuelSeatBackfillService(
				{ query: mockReadQuery },
				{ query: mockWriteQuery },
			);
		});

		it("dry-run produces candidate report and performs zero writes", async () => {
			const gameId = "game-001";
			const replayId = "replay-g1";
			const replayBytes = createReplayBytes({ hostName: "Alice", clientName: "Bob" });

			// 1. games query
			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId }]));
			// 2. matches query
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{ id: "m-1", userId: "u-1", playerNames: "Alice", opponentNames: "Bob" },
					{ id: "m-2", userId: "u-2", playerNames: "Bob", opponentNames: "Alice" },
				]),
			);
			// 3. duels query
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "d-1",
						matchId: "m-1",
						userId: "u-1",
						replayId,
						duelIndex: null,
						isFirst: null,
					},
					{
						id: "d-2",
						matchId: "m-2",
						userId: "u-2",
						replayId,
						duelIndex: null,
						isFirst: null,
					},
				]),
			);
			// 4. duel_replays query
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: replayId,
						gameId,
						formatId: "1109",
						duelIndex: 1,
						replayData: replayBytes,
					},
				]),
			);

			const report = await service.run({ formatId: "1109", dryRun: true });

			expect(report.scannedGames).toBe(1);
			expect(report.candidates).toBe(1);
			expect(report.successfulGames).toBe(1);
			expect(report.seatsConfirmedDuels).toBe(2);
			expect(report.indexOnlyConfirmedDuels).toBe(0);
			expect(report.unknownDuels).toBe(0);
			expect(report.conflictDuels).toBe(0);
			expect(mockWriteQuery).not.toHaveBeenCalled();
		});

		it("execute mode writes confirmed seats in a single transaction", async () => {
			const gameId = "game-002";
			const replayId = "replay-g1";
			const replayBytes = createReplayBytes({ hostName: "Alice", clientName: "Bob" });

			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId }]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{ id: "m-1", userId: "u-1", playerNames: "Alice", opponentNames: "Bob" },
					{ id: "m-2", userId: "u-2", playerNames: "Bob", opponentNames: "Alice" },
				]),
			);
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "d-1",
						matchId: "m-1",
						userId: "u-1",
						replayId,
						duelIndex: null,
						isFirst: null,
					},
					{
						id: "d-2",
						matchId: "m-2",
						userId: "u-2",
						replayId,
						duelIndex: null,
						isFirst: null,
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: replayId,
						gameId,
						formatId: "1109",
						duelIndex: 1,
						replayData: replayBytes,
					},
				]),
			);
			mockWriteQuery.mockResolvedValue(pgRows([]));

			const report = await service.run({ formatId: "1109", dryRun: false });

			expect(report.successfulGames).toBe(1);
			expect(report.seatsConfirmedDuels).toBe(2);

			expect(mockWriteQuery).toHaveBeenCalledWith("BEGIN");
			expect(mockWriteQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE duels"), [
				1,
				true,
				"d-1",
			]);
			expect(mockWriteQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE duels"), [
				1,
				false,
				"d-2",
			]);
			expect(mockWriteQuery).toHaveBeenCalledWith("COMMIT");
		});

		it("skips writing and increments alreadyConfirmed when values match target", async () => {
			const gameId = "game-003";
			const replayId = "replay-g1";
			const replayBytes = createReplayBytes({ hostName: "Alice", clientName: "Bob" });

			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId }]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{ id: "m-1", userId: "u-1", playerNames: "Alice", opponentNames: "Bob" },
					{ id: "m-2", userId: "u-2", playerNames: "Bob", opponentNames: "Alice" },
				]),
			);
			// Already confirmed
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "d-1",
						matchId: "m-1",
						userId: "u-1",
						replayId,
						duelIndex: 1,
						isFirst: true,
					},
					{
						id: "d-2",
						matchId: "m-2",
						userId: "u-2",
						replayId,
						duelIndex: 1,
						isFirst: false,
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: replayId,
						gameId,
						formatId: "1109",
						duelIndex: 1,
						replayData: replayBytes,
					},
				]),
			);

			const report = await service.run({ formatId: "1109", dryRun: false });

			expect(report.skipped.alreadyConfirmed).toBe(2);
			expect(report.seatsConfirmedDuels).toBe(0);
			expect(mockWriteQuery).not.toHaveBeenCalled();
		});

		it("detects conflict with trusted online values and skips the entire match", async () => {
			const gameId = "game-004";
			const replayId = "replay-g1";
			const replayBytes = createReplayBytes({ hostName: "Alice", clientName: "Bob" });

			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId }]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{ id: "m-1", userId: "u-1", playerNames: "Alice", opponentNames: "Bob" },
					{ id: "m-2", userId: "u-2", playerNames: "Bob", opponentNames: "Alice" },
				]),
			);
			// d-1 conflicts: target is isFirst=true, but database has isFirst=false!
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "d-1",
						matchId: "m-1",
						userId: "u-1",
						replayId,
						duelIndex: 1,
						isFirst: false,
					},
					{
						id: "d-2",
						matchId: "m-2",
						userId: "u-2",
						replayId,
						duelIndex: null,
						isFirst: null,
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: replayId,
						gameId,
						formatId: "1109",
						duelIndex: 1,
						replayData: replayBytes,
					},
				]),
			);

			const report = await service.run({ formatId: "1109", dryRun: false });

			expect(report.conflictDuels).toBe(1);
			expect(report.successfulGames).toBe(0);
			expect(report.seatsConfirmedDuels).toBe(0);
			expect(mockWriteQuery).not.toHaveBeenCalled();
		});

		it("handles missing or placeholder replay_id as unknownDuels", async () => {
			const gameId = "game-005";
			const placeholderReplayId = "placeholder-uuid";

			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId }]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{ id: "m-1", userId: "u-1", playerNames: "Alice", opponentNames: "Bob" },
					{ id: "m-2", userId: "u-2", playerNames: "Bob", opponentNames: "Alice" },
				]),
			);
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "d-1",
						matchId: "m-1",
						userId: "u-1",
						replayId: placeholderReplayId,
						duelIndex: null,
						isFirst: null,
					},
					{
						id: "d-2",
						matchId: "m-2",
						userId: "u-2",
						replayId: placeholderReplayId,
						duelIndex: null,
						isFirst: null,
					},
				]),
			);
			// duel_replays query returns empty because placeholder UUID doesn't exist in duel_replays
			mockReadQuery.mockResolvedValueOnce(pgRows([]));

			const report = await service.run({ formatId: "1109", dryRun: false });

			expect(report.unknownDuels).toBe(2);
			expect(report.seatsConfirmedDuels).toBe(0);
			expect(mockWriteQuery).not.toHaveBeenCalled();
		});

		it("backfills duel_index only when replay exists but seats cannot be resolved", async () => {
			const gameId = "game-006";
			const replayId = "replay-g2";
			// Corrupted/empty replay bytes
			const corruptedBytes = Buffer.alloc(10);

			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId }]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{ id: "m-1", userId: "u-1", playerNames: "Alice", opponentNames: "Bob" },
					{ id: "m-2", userId: "u-2", playerNames: "Bob", opponentNames: "Alice" },
				]),
			);
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "d-1",
						matchId: "m-1",
						userId: "u-1",
						replayId,
						duelIndex: null,
						isFirst: null,
					},
					{
						id: "d-2",
						matchId: "m-2",
						userId: "u-2",
						replayId,
						duelIndex: null,
						isFirst: null,
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: replayId,
						gameId,
						formatId: "1109",
						duelIndex: 2,
						replayData: corruptedBytes,
					},
				]),
			);
			mockWriteQuery.mockResolvedValue(pgRows([]));

			const report = await service.run({ formatId: "1109", dryRun: false });

			expect(report.indexOnlyConfirmedDuels).toBe(2);
			expect(report.seatsConfirmedDuels).toBe(0);
			expect(mockWriteQuery).toHaveBeenCalledWith("BEGIN");
			expect(mockWriteQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE duels"), [
				2,
				null,
				"d-1",
			]);
			expect(mockWriteQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE duels"), [
				2,
				null,
				"d-2",
			]);
			expect(mockWriteQuery).toHaveBeenCalledWith("COMMIT");
		});

		it("rolls back transaction and records failedGameId on write error", async () => {
			const gameId = "game-007";
			const replayId = "replay-g1";
			const replayBytes = createReplayBytes({ hostName: "Alice", clientName: "Bob" });

			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId }]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{ id: "m-1", userId: "u-1", playerNames: "Alice", opponentNames: "Bob" },
					{ id: "m-2", userId: "u-2", playerNames: "Bob", opponentNames: "Alice" },
				]),
			);
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "d-1",
						matchId: "m-1",
						userId: "u-1",
						replayId,
						duelIndex: null,
						isFirst: null,
					},
					{
						id: "d-2",
						matchId: "m-2",
						userId: "u-2",
						replayId,
						duelIndex: null,
						isFirst: null,
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: replayId,
						gameId,
						formatId: "1109",
						duelIndex: 1,
						replayData: replayBytes,
					},
				]),
			);

			mockWriteQuery.mockResolvedValueOnce(pgRows([])); // BEGIN
			mockWriteQuery.mockRejectedValueOnce(new Error("Disk full or connection error")); // UPDATE fails
			mockWriteQuery.mockResolvedValueOnce(pgRows([])); // ROLLBACK

			const report = await service.run({ formatId: "1109", dryRun: false });

			expect(report.successfulGames).toBe(0);
			expect(report.failedGameIds).toEqual([gameId]);
			expect(report.skipped.writeFailed).toBe(1);
			expect(mockWriteQuery).toHaveBeenCalledWith("ROLLBACK");
		});
	});
});
