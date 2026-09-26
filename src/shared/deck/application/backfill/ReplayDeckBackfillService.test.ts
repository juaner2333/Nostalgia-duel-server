import {
	ReplayDeckBackfillService,
	validateDatabaseConfigs,
	PostgresConnectionConfig,
} from "./ReplayDeckBackfillService";
import { DuelRecordMother } from "@test-support/mothers/room/DuelRecordMother";
import YGOProDeck from "ygopro-deck-encode";

describe("ReplayDeckBackfillService", () => {
	describe("Task 7.3: Database configuration and same-target precheck", () => {
		it("accepts identical host, port, and database targets", () => {
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
	});

	describe("Task 7.2, 7.4, 7.5: Backfill execution, dry-run, idempotence, and conflict protection", () => {
		let service: ReplayDeckBackfillService;
		let mockReadQuery: jest.Mock;
		let mockWriteQuery: jest.Mock;

		function createG1ReplayBytes(hostName: string, clientName: string): Buffer {
			const record = DuelRecordMother.create({
				players: [
					{
						name: hostName,
						deck: new YGOProDeck({
							main: new Array(40).fill(46986414),
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
			// Zero database writes in dry-run
			expect(mockWriteQuery).toHaveBeenCalledTimes(0);
		});

		it("execute mode saves match_decks with snapshot_source=replay_backfill and sideCards=null", async () => {
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
			expect(mockWriteQuery).toHaveBeenCalledTimes(2); // Two players inserted
			const insert1 = mockWriteQuery.mock.calls[0];
			expect(insert1[0]).toContain("INSERT INTO match_decks");
			expect(insert1[1]).toContain("replay_backfill");
			expect(insert1[1]).toContain("m-1");
			// null side_cards
			expect(insert1[1]).toContain(null);
		});

		it("skips match when online snapshot already exists without overwriting", async () => {
			const gameId = "game-103";

			mockReadQuery.mockResolvedValueOnce([{ gameId }]);
			// Online snapshot check returns existing row
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
			// Replay has "Charlie" vs "Dave", but matches say "Alice" vs "Bob"
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
