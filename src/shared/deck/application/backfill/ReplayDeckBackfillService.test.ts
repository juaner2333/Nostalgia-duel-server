import {
	ReplayDeckBackfillService,
	validateDatabaseConfigs,
	verifyConnectionPermissions,
	PostgresConnectionConfig,
} from "./ReplayDeckBackfillService";
import { DuelRecordMother } from "@test-support/mothers/room/DuelRecordMother";
import YGOProDeck from "ygopro-deck-encode";

describe("ReplayDeckBackfillService", () => {
	describe("Task 7.3: Database configuration and same-target precheck", () => {
		it("accepts identical host, port, and database targets with distinct users", () => {
			const readConfig: PostgresConnectionConfig = {
				host: "127.0.0.1",
				port: 5432,
				database: "nostalgia_db",
				user: "readonly_user",
				password: "secret_read_password",
			};
			const writeConfig: PostgresConnectionConfig = {
				host: "127.0.0.1",
				port: 5432,
				database: "nostalgia_db",
				user: "app_user",
				password: "secret_write_password",
			};

			const res = validateDatabaseConfigs(readConfig, writeConfig);
			expect(res.valid).toBe(true);
			expect(res.error).toBeUndefined();
		});

		it("rejects when readonly or write config is missing required fields without leaking secrets", () => {
			const incompleteRead: any = {
				host: "127.0.0.1",
				port: 5432,
				// missing database and user
			};
			const writeConfig: PostgresConnectionConfig = {
				host: "127.0.0.1",
				port: 5432,
				database: "nostalgia_db",
				user: "app_user",
			};

			const res = validateDatabaseConfigs(incompleteRead, writeConfig);
			expect(res.valid).toBe(false);
			expect(res.error).toBe("Missing database connection parameters");
			// Must never leak secrets or passwords
			expect(JSON.stringify(res)).not.toContain("password");
		});

		it("rejects different database names or hosts without leaking connection string", () => {
			const readConfig: PostgresConnectionConfig = {
				host: "10.0.0.1",
				port: 5432,
				database: "db_replica",
				user: "readonly_user",
			};
			const writeConfig: PostgresConnectionConfig = {
				host: "10.0.0.2",
				port: 5432,
				database: "db_primary",
				user: "app_user",
			};

			const res = validateDatabaseConfigs(readConfig, writeConfig);
			expect(res.valid).toBe(false);
			expect(res.error).toBe(
				"READONLY and WRITE connections must point to the same database target",
			);
			expect(JSON.stringify(res)).not.toContain("10.0.0.1");
			expect(JSON.stringify(res)).not.toContain("db_replica");
		});

		it("rejects identical username between readonly and write accounts", () => {
			const readConfig: PostgresConnectionConfig = {
				host: "127.0.0.1",
				port: 5432,
				database: "nostalgia_db",
				user: "app_user",
			};
			const writeConfig: PostgresConnectionConfig = {
				host: "127.0.0.1",
				port: 5432,
				database: "nostalgia_db",
				user: "app_user",
			};

			const res = validateDatabaseConfigs(readConfig, writeConfig);
			expect(res.valid).toBe(false);
			expect(res.error).toContain("distinct readonly user");
		});

		it("verifyConnectionPermissions checks SELECT for readonly and INSERT for write", async () => {
			const mockRead = {
				query: jest.fn().mockResolvedValue([{ can_select: true }]),
			};
			const mockWrite = {
				query: jest.fn().mockResolvedValue([{ can_insert: true }]),
			};

			// When both have privileges in execute mode
			const passRes = await verifyConnectionPermissions(mockRead, mockWrite, true);
			expect(passRes.valid).toBe(true);

			// When readonly lacks SELECT
			mockRead.query.mockResolvedValueOnce([{ can_select: false }]);
			const readFail = await verifyConnectionPermissions(mockRead, mockWrite, true);
			expect(readFail.valid).toBe(false);
			expect(readFail.error).toContain("READONLY user does not have SELECT");

			// When write lacks INSERT in execute mode
			mockRead.query.mockResolvedValueOnce([{ can_select: true }]);
			mockWrite.query.mockResolvedValueOnce([{ can_insert: false }]);
			const writeFail = await verifyConnectionPermissions(mockRead, mockWrite, true);
			expect(writeFail.valid).toBe(false);
			expect(writeFail.error).toContain("WRITE user does not have INSERT");

			// Dry run skips write privilege check
			mockRead.query.mockResolvedValueOnce([{ can_select: true }]);
			const dryPass = await verifyConnectionPermissions(mockRead, mockWrite, false);
			expect(dryPass.valid).toBe(true);
		});
	});

	describe("Task 7.2, 7.4, 7.5: Backfill execution, dry-run, idempotence, and conflict protection", () => {
		let service: ReplayDeckBackfillService;
		let mockReadQuery: jest.Mock;
		let mockWriteQuery: jest.Mock;

		function createG1ReplayBytes(
			hostName: string,
			clientName: string,
			hostMain?: number[],
		): Buffer {
			const record = DuelRecordMother.create({
				players: [
					{
						name: hostName,
						deck: new YGOProDeck({
							main: hostMain ?? new Array(40).fill(46986414),
							extra: [83764718],
							side: [],
						}),
					},
					{
						name: clientName,
						deck: new YGOProDeck({ main: new Array(40).fill(33398782), extra: [], side: [] }),
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
			mockReadQuery = jest.fn();
			mockWriteQuery = jest.fn();
			service = new ReplayDeckBackfillService({ query: mockReadQuery }, { query: mockWriteQuery });
		});

		it("dry-run produces statistics report and performs zero database writes", async () => {
			const gameId = "game-101";
			const replayBytes = createG1ReplayBytes("Alice", "Bob");

			// 1. Candidate gameIds query
			mockReadQuery.mockResolvedValueOnce([{ gameId }]);
			// 2. Online snapshot check
			mockReadQuery.mockResolvedValueOnce([]);
			// 3. Already backfilled check
			mockReadQuery.mockResolvedValueOnce([]);
			// 4. Two matches query
			mockReadQuery.mockResolvedValueOnce([
				{ id: "m-1", userId: "u-1", playerNames: "Alice", opponentNames: "Bob", formatId: "1109" },
				{ id: "m-2", userId: "u-2", playerNames: "Bob", opponentNames: "Alice", formatId: "1109" },
			]);
			// 5. G1 duel_replays query
			mockReadQuery.mockResolvedValueOnce([{ id: "r-1", replayData: replayBytes }]);

			const report = await service.run({
				formatId: "1109",
				dryRun: true,
			});

			expect(report.formatId).toBe("1109");
			expect(report.dryRun).toBe(true);
			expect(report.scannedGames).toBe(1);
			expect(report.candidates).toBe(1);
			expect(report.successful).toBe(1);
			expect(report.lastGameId).toBe(gameId);
			// Zero database writes in dry-run
			expect(mockWriteQuery).toHaveBeenCalledTimes(0);
		});

		it("execute mode saves match_decks in a single transaction with BEGIN, INSERT, INSERT, COMMIT", async () => {
			const gameId = "game-102";
			const replayBytes = createG1ReplayBytes("Alice", "Bob");

			mockReadQuery.mockResolvedValueOnce([{ gameId }]);
			mockReadQuery.mockResolvedValueOnce([]);
			mockReadQuery.mockResolvedValueOnce([]);
			mockReadQuery.mockResolvedValueOnce([
				{ id: "m-1", userId: "u-1", playerNames: "Alice", opponentNames: "Bob", formatId: "1109" },
				{ id: "m-2", userId: "u-2", playerNames: "Bob", opponentNames: "Alice", formatId: "1109" },
			]);
			mockReadQuery.mockResolvedValueOnce([{ id: "r-1", replayData: replayBytes }]);

			mockWriteQuery.mockResolvedValue({ rowCount: 1 });

			const report = await service.run({
				formatId: "1109",
				dryRun: false,
			});

			expect(report.successful).toBe(1);
			// Transaction: BEGIN, INSERT m1, INSERT m2, COMMIT
			expect(mockWriteQuery).toHaveBeenCalledTimes(4);
			expect(mockWriteQuery.mock.calls[0][0]).toBe("BEGIN");

			const insert1 = mockWriteQuery.mock.calls[1];
			expect(insert1[0]).toContain("INSERT INTO match_decks");
			expect(insert1[1]).toContain("replay_backfill");
			expect(insert1[1]).toContain("m-1");
			expect(insert1[1]).toContain(null);

			const insert2 = mockWriteQuery.mock.calls[2];
			expect(insert2[0]).toContain("INSERT INTO match_decks");
			expect(insert2[1]).toContain("replay_backfill");
			expect(insert2[1]).toContain("m-2");

			expect(mockWriteQuery.mock.calls[3][0]).toBe("COMMIT");
		});

		it("rolls back transaction when second insert fails and does not leave single-sided record", async () => {
			const gameId = "game-rollback";
			const replayBytes = createG1ReplayBytes("Alice", "Bob");

			mockReadQuery.mockResolvedValueOnce([{ gameId }]);
			mockReadQuery.mockResolvedValueOnce([]);
			mockReadQuery.mockResolvedValueOnce([]);
			mockReadQuery.mockResolvedValueOnce([
				{ id: "m-1", userId: "u-1", playerNames: "Alice", opponentNames: "Bob", formatId: "1109" },
				{ id: "m-2", userId: "u-2", playerNames: "Bob", opponentNames: "Alice", formatId: "1109" },
			]);
			mockReadQuery.mockResolvedValueOnce([{ id: "r-1", replayData: replayBytes }]);

			// BEGIN succeeds
			mockWriteQuery.mockResolvedValueOnce({ rowCount: 1 });
			// INSERT m1 succeeds
			mockWriteQuery.mockResolvedValueOnce({ rowCount: 1 });
			// INSERT m2 throws
			mockWriteQuery.mockRejectedValueOnce(new Error("Connection reset"));
			// ROLLBACK succeeds
			mockWriteQuery.mockResolvedValueOnce({ rowCount: 1 });

			const report = await service.run({
				formatId: "1109",
				dryRun: false,
			});

			expect(report.successful).toBe(0);
			expect(report.skipped.writeFailed).toBe(1);
			// Verifies ROLLBACK was issued
			expect(mockWriteQuery).toHaveBeenCalledWith("ROLLBACK");
		});

		it("supports bounded pagination and cursor resume with batchSize", async () => {
			const replay1 = createG1ReplayBytes("Alice", "Bob");
			const replay2 = createG1ReplayBytes("Charlie", "Dave");

			// Batch 1: returns game-1, game-2 (batchSize = 2)
			mockReadQuery.mockResolvedValueOnce([{ gameId: "game-1" }, { gameId: "game-2" }]);
			// Game 1 checks & data
			mockReadQuery.mockResolvedValueOnce([]);
			mockReadQuery.mockResolvedValueOnce([]);
			mockReadQuery.mockResolvedValueOnce([
				{ id: "m-1", userId: "u-1", playerNames: "Alice", opponentNames: "Bob", formatId: "1109" },
				{ id: "m-2", userId: "u-2", playerNames: "Bob", opponentNames: "Alice", formatId: "1109" },
			]);
			mockReadQuery.mockResolvedValueOnce([{ id: "r-1", replayData: replay1 }]);

			// Game 2 checks & data
			mockReadQuery.mockResolvedValueOnce([]);
			mockReadQuery.mockResolvedValueOnce([]);
			mockReadQuery.mockResolvedValueOnce([
				{
					id: "m-3",
					userId: "u-3",
					playerNames: "Charlie",
					opponentNames: "Dave",
					formatId: "1109",
				},
				{
					id: "m-4",
					userId: "u-4",
					playerNames: "Dave",
					opponentNames: "Charlie",
					formatId: "1109",
				},
			]);
			mockReadQuery.mockResolvedValueOnce([{ id: "r-2", replayData: replay2 }]);

			// Batch 2: queries with game_id > 'game-2', returns empty
			mockReadQuery.mockResolvedValueOnce([]);

			const report = await service.run({
				formatId: "1109",
				dryRun: true,
				batchSize: 2,
			});

			expect(report.scannedGames).toBe(2);
			expect(report.candidates).toBe(2);
			expect(report.lastGameId).toBe("game-2");

			// Verify Batch 2 query used cursor
			const batch2Call = mockReadQuery.mock.calls[9]; // 1 batch query + 4 for game1 + 4 for game2 = call 9 is batch 2
			expect(batch2Call[0]).toContain("m.game_id > $2");
			expect(batch2Call[1]).toContain("game-2");
		});

		it("classifies alt-art card 85138717 as D03 during backfill using CDB alias mapping", async () => {
			const gameId = "game-alt-art";
			const filler = Array.from({ length: 35 }, (_, i) => 10000000 + i);
			const altArtMain = [85138717, 85138717, 10802915, 37265642, 37265642, ...filler];
			const replayBytes = createG1ReplayBytes("Alice", "Bob", altArtMain);

			mockReadQuery.mockResolvedValueOnce([{ gameId }]);
			mockReadQuery.mockResolvedValueOnce([]);
			mockReadQuery.mockResolvedValueOnce([]);
			mockReadQuery.mockResolvedValueOnce([
				{ id: "m-1", userId: "u-1", playerNames: "Alice", opponentNames: "Bob", formatId: "1109" },
				{ id: "m-2", userId: "u-2", playerNames: "Bob", opponentNames: "Alice", formatId: "1109" },
			]);
			mockReadQuery.mockResolvedValueOnce([{ id: "r-1", replayData: replayBytes }]);

			mockWriteQuery.mockResolvedValue({ rowCount: 1 });

			const report = await service.run({
				formatId: "1109",
				dryRun: false,
			});

			expect(report.successful).toBe(1);
			const insertCall = mockWriteQuery.mock.calls[1];
			// m1 used altArtMain -> classified as D03
			expect(insertCall[1][2]).toBe("D03");
		});

		it("skips match when online snapshot already exists without overwriting", async () => {
			const gameId = "game-103";

			mockReadQuery.mockResolvedValueOnce([{ gameId }]);
			mockReadQuery.mockResolvedValueOnce([{ exists: 1 }]);

			const report = await service.run({
				formatId: "1109",
				dryRun: false,
			});

			expect(report.successful).toBe(0);
			expect(report.skipped.onlineSnapshotExists).toBe(1);
			expect(mockWriteQuery).toHaveBeenCalledTimes(0);
		});

		it("skips match when player identity is ambiguous", async () => {
			const gameId = "game-104";
			const replayBytes = createG1ReplayBytes("Charlie", "Dave");

			mockReadQuery.mockResolvedValueOnce([{ gameId }]);
			mockReadQuery.mockResolvedValueOnce([]);
			mockReadQuery.mockResolvedValueOnce([]);
			mockReadQuery.mockResolvedValueOnce([
				{ id: "m-1", userId: "u-1", playerNames: "Alice", opponentNames: "Bob", formatId: "1109" },
				{ id: "m-2", userId: "u-2", playerNames: "Bob", opponentNames: "Alice", formatId: "1109" },
			]);
			mockReadQuery.mockResolvedValueOnce([{ id: "r-1", replayData: replayBytes }]);

			const report = await service.run({
				formatId: "1109",
				dryRun: false,
			});

			expect(report.successful).toBe(0);
			expect(report.skipped.ambiguousIdentity).toBe(1);
			expect(mockWriteQuery).toHaveBeenCalledTimes(0);
		});
	});
});
