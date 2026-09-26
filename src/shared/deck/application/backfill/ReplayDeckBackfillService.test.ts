import {
	ReplayDeckBackfillService,
	validateDatabaseConfigs,
	verifyConnectionPermissions,
	sanitizeDatabaseError,
	PostgresConnectionConfig,
} from "./ReplayDeckBackfillService";
import { DuelRecordMother } from "@test-support/mothers/room/DuelRecordMother";
import YGOProDeck from "ygopro-deck-encode";

const pgRows = <T>(rows: T[]) => ({ rows, rowCount: rows.length });

describe("ReplayDeckBackfillService", () => {
	describe("Task 7.3: Database configuration, permission verification, and error sanitization", () => {
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

		it("sanitizeDatabaseError categorizes errors without leaking credentials or addresses", () => {
			const authErr = new Error(
				'password authentication failed for user "postgres" on host 10.0.0.1:5432',
			);
			(authErr as any).code = "28P01";
			const res1 = sanitizeDatabaseError(authErr);
			expect(res1).toBe("AuthenticationFailedError");
			expect(res1).not.toContain("postgres");
			expect(res1).not.toContain("10.0.0.1");

			const connErr = new Error("connect ECONNREFUSED 127.0.0.1:5433");
			(connErr as any).code = "ECONNREFUSED";
			const res2 = sanitizeDatabaseError(connErr);
			expect(res2).toBe("ConnectionRefusedError");
			expect(res2).not.toContain("127.0.0.1");

			const privErr = new Error('permission denied for table "matches" by user readonly_rpt');
			(privErr as any).code = "42501";
			const res3 = sanitizeDatabaseError(privErr);
			expect(res3).toBe("InsufficientPrivilegeError");
			expect(res3).not.toContain("readonly_rpt");
		});

		it("verifyConnectionPermissions checks SELECT for readonly and INSERT for write using pg { rows }", async () => {
			const mockRead = {
				query: jest.fn().mockResolvedValue(pgRows([{ can_select: true }])),
			};
			const mockWrite = {
				query: jest.fn().mockResolvedValue(pgRows([{ can_insert: true }])),
			};

			const passRes = await verifyConnectionPermissions(mockRead, mockWrite, true);
			expect(passRes.valid).toBe(true);

			mockRead.query.mockResolvedValueOnce(pgRows([{ can_select: false }]));
			const readFail = await verifyConnectionPermissions(mockRead, mockWrite, true);
			expect(readFail.valid).toBe(false);
			expect(readFail.error).toContain("READONLY user does not have SELECT");

			mockRead.query.mockResolvedValueOnce(pgRows([{ can_select: true }]));
			mockWrite.query.mockResolvedValueOnce(pgRows([{ can_insert: false }]));
			const writeFail = await verifyConnectionPermissions(mockRead, mockWrite, true);
			expect(writeFail.valid).toBe(false);
			expect(writeFail.error).toContain("WRITE user does not have INSERT");

			mockRead.query.mockResolvedValueOnce(pgRows([{ can_select: true }]));
			const dryPass = await verifyConnectionPermissions(mockRead, mockWrite, false);
			expect(dryPass.valid).toBe(true);
		});

		it("verifyConnectionPermissions masks underlying database connection errors", async () => {
			const mockRead = {
				query: jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432")),
			};
			const mockWrite = { query: jest.fn() };
			const res = await verifyConnectionPermissions(mockRead, mockWrite, false);
			expect(res.valid).toBe(false);
			expect(res.error).toBe("READONLY connection precheck failed: ConnectionRefusedError");
			expect(res.error).not.toContain("10.0.0.1");
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

		it("dry-run produces statistics report with pg { rows } and performs zero writes", async () => {
			const gameId = "game-101";
			const replayBytes = createG1ReplayBytes("Alice", "Bob");

			// Real pg.Pool returns { rows: [...] }
			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId }]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "m-1",
						userId: "u-1",
						playerNames: "Alice",
						opponentNames: "Bob",
						formatId: "1109",
					},
					{
						id: "m-2",
						userId: "u-2",
						playerNames: "Bob",
						opponentNames: "Alice",
						formatId: "1109",
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(pgRows([{ id: "r-1", replayData: replayBytes }]));

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
			expect(report.resumeCursor).toBe(gameId);
			expect(report.failedGameIds).toEqual([]);
			expect(mockWriteQuery).toHaveBeenCalledTimes(0);
		});

		it("execute mode saves match_decks in a single transaction with BEGIN, INSERT, INSERT, COMMIT", async () => {
			const gameId = "game-102";
			const replayBytes = createG1ReplayBytes("Alice", "Bob");

			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId }]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "m-1",
						userId: "u-1",
						playerNames: "Alice",
						opponentNames: "Bob",
						formatId: "1109",
					},
					{
						id: "m-2",
						userId: "u-2",
						playerNames: "Bob",
						opponentNames: "Alice",
						formatId: "1109",
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(pgRows([{ id: "r-1", replayData: replayBytes }]));

			mockWriteQuery.mockResolvedValue(pgRows([]));

			const report = await service.run({
				formatId: "1109",
				dryRun: false,
			});

			expect(report.successful).toBe(1);
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

		it("rolls back transaction when second insert fails and preserves failed game in report", async () => {
			const gameId = "game-rollback";
			const replayBytes = createG1ReplayBytes("Alice", "Bob");

			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId }]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "m-1",
						userId: "u-1",
						playerNames: "Alice",
						opponentNames: "Bob",
						formatId: "1109",
					},
					{
						id: "m-2",
						userId: "u-2",
						playerNames: "Bob",
						opponentNames: "Alice",
						formatId: "1109",
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(pgRows([{ id: "r-1", replayData: replayBytes }]));

			mockWriteQuery.mockResolvedValueOnce(pgRows([])); // BEGIN
			mockWriteQuery.mockResolvedValueOnce(pgRows([])); // INSERT m1
			mockWriteQuery.mockRejectedValueOnce(new Error("Connection reset")); // INSERT m2 fails
			mockWriteQuery.mockResolvedValueOnce(pgRows([])); // ROLLBACK

			const report = await service.run({
				formatId: "1109",
				dryRun: false,
			});

			expect(report.successful).toBe(0);
			expect(report.skipped.writeFailed).toBe(1);
			expect(report.failedGameIds).toEqual(["game-rollback"]);
			expect(report.resumeCursor).toBeUndefined(); // Safe resume point does not advance past failed game
			expect(mockWriteQuery).toHaveBeenCalledWith("ROLLBACK");
		});

		it("retains failed game in resume cursor across multiple games", async () => {
			const replay = createG1ReplayBytes("Alice", "Bob");

			// Batch returns 3 games: g1, g2, g3
			mockReadQuery.mockResolvedValueOnce(
				pgRows([{ gameId: "g1" }, { gameId: "g2" }, { gameId: "g3" }]),
			);

			// Game 1 setup (success)
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "m-1",
						userId: "u-1",
						playerNames: "Alice",
						opponentNames: "Bob",
						formatId: "1109",
					},
					{
						id: "m-2",
						userId: "u-2",
						playerNames: "Bob",
						opponentNames: "Alice",
						formatId: "1109",
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(pgRows([{ id: "r-1", replayData: replay }]));

			// Game 2 setup (will fail on write)
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "m-3",
						userId: "u-3",
						playerNames: "Alice",
						opponentNames: "Bob",
						formatId: "1109",
					},
					{
						id: "m-4",
						userId: "u-4",
						playerNames: "Bob",
						opponentNames: "Alice",
						formatId: "1109",
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(pgRows([{ id: "r-2", replayData: replay }]));

			// Game 3 setup (success)
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "m-5",
						userId: "u-5",
						playerNames: "Alice",
						opponentNames: "Bob",
						formatId: "1109",
					},
					{
						id: "m-6",
						userId: "u-6",
						playerNames: "Bob",
						opponentNames: "Alice",
						formatId: "1109",
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(pgRows([{ id: "r-3", replayData: replay }]));

			// Game 1 write: BEGIN, INSERT, INSERT, COMMIT
			mockWriteQuery.mockResolvedValueOnce(pgRows([]));
			mockWriteQuery.mockResolvedValueOnce(pgRows([]));
			mockWriteQuery.mockResolvedValueOnce(pgRows([]));
			mockWriteQuery.mockResolvedValueOnce(pgRows([]));

			// Game 2 write: BEGIN, INSERT, INSERT (fails), ROLLBACK
			mockWriteQuery.mockResolvedValueOnce(pgRows([]));
			mockWriteQuery.mockResolvedValueOnce(pgRows([]));
			mockWriteQuery.mockRejectedValueOnce(new Error("Deadlock detected"));
			mockWriteQuery.mockResolvedValueOnce(pgRows([]));

			// Game 3 write: BEGIN, INSERT, INSERT, COMMIT
			mockWriteQuery.mockResolvedValueOnce(pgRows([]));
			mockWriteQuery.mockResolvedValueOnce(pgRows([]));
			mockWriteQuery.mockResolvedValueOnce(pgRows([]));
			mockWriteQuery.mockResolvedValueOnce(pgRows([]));

			const report = await service.run({
				formatId: "1109",
				dryRun: false,
			});

			expect(report.scannedGames).toBe(3);
			expect(report.successful).toBe(2);
			expect(report.failedGameIds).toEqual(["g2"]);
			// Crucial: resumeCursor is g1 (safe point before failure), while lastGameId is g3
			expect(report.resumeCursor).toBe("g1");
			expect(report.lastGameId).toBe("g3");
		});

		it("supports bounded pagination and cursor resume with batchSize", async () => {
			const replay1 = createG1ReplayBytes("Alice", "Bob");
			const replay2 = createG1ReplayBytes("Charlie", "Dave");

			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId: "game-1" }, { gameId: "game-2" }]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "m-1",
						userId: "u-1",
						playerNames: "Alice",
						opponentNames: "Bob",
						formatId: "1109",
					},
					{
						id: "m-2",
						userId: "u-2",
						playerNames: "Bob",
						opponentNames: "Alice",
						formatId: "1109",
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(pgRows([{ id: "r-1", replayData: replay1 }]));

			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
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
				]),
			);
			mockReadQuery.mockResolvedValueOnce(pgRows([{ id: "r-2", replayData: replay2 }]));

			mockReadQuery.mockResolvedValueOnce(pgRows([]));

			const report = await service.run({
				formatId: "1109",
				dryRun: true,
				batchSize: 2,
			});

			expect(report.scannedGames).toBe(2);
			expect(report.candidates).toBe(2);
			expect(report.lastGameId).toBe("game-2");
			expect(report.resumeCursor).toBe("game-2");

			const batch2Call = mockReadQuery.mock.calls[9];
			expect(batch2Call[0]).toContain("m.game_id > $2");
			expect(batch2Call[1]).toContain("game-2");
		});

		it("classifies alt-art card 85138717 as D03 during backfill using CDB alias mapping", async () => {
			const gameId = "game-alt-art";
			const filler = Array.from({ length: 35 }, (_, i) => 10000000 + i);
			const altArtMain = [85138717, 85138717, 10802915, 37265642, 37265642, ...filler];
			const replayBytes = createG1ReplayBytes("Alice", "Bob", altArtMain);

			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId }]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "m-1",
						userId: "u-1",
						playerNames: "Alice",
						opponentNames: "Bob",
						formatId: "1109",
					},
					{
						id: "m-2",
						userId: "u-2",
						playerNames: "Bob",
						opponentNames: "Alice",
						formatId: "1109",
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(pgRows([{ id: "r-1", replayData: replayBytes }]));

			mockWriteQuery.mockResolvedValue(pgRows([]));

			const report = await service.run({
				formatId: "1109",
				dryRun: false,
			});

			expect(report.successful).toBe(1);
			const insertCall = mockWriteQuery.mock.calls[1];
			expect(insertCall[1][2]).toBe("D03");
		});

		it("skips match when online snapshot already exists without overwriting", async () => {
			const gameId = "game-103";

			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId }]));
			mockReadQuery.mockResolvedValueOnce(pgRows([{ exists: 1 }]));

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

			mockReadQuery.mockResolvedValueOnce(pgRows([{ gameId }]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(pgRows([]));
			mockReadQuery.mockResolvedValueOnce(
				pgRows([
					{
						id: "m-1",
						userId: "u-1",
						playerNames: "Alice",
						opponentNames: "Bob",
						formatId: "1109",
					},
					{
						id: "m-2",
						userId: "u-2",
						playerNames: "Bob",
						opponentNames: "Alice",
						formatId: "1109",
					},
				]),
			);
			mockReadQuery.mockResolvedValueOnce(pgRows([{ id: "r-1", replayData: replayBytes }]));

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
