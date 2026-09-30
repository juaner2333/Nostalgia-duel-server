import { DeckDetailPostgresRepository } from "./DeckDetailPostgresRepository";
import { dataSource } from "../../../../../evolution-types/src/data-source";
import { DeckDetailTimeWindow } from "../../domain/DeckDetailRepository";

jest.mock("../../../../../evolution-types/src/data-source", () => ({
	dataSource: {
		createQueryRunner: jest.fn(),
	},
}));

describe("DeckDetailPostgresRepository Unit Tests", () => {
	let repository: DeckDetailPostgresRepository;
	let mockQueryRunner: any;

	beforeEach(() => {
		mockQueryRunner = {
			connect: jest.fn().mockResolvedValue(undefined),
			startTransaction: jest.fn().mockResolvedValue(undefined),
			commitTransaction: jest.fn().mockResolvedValue(undefined),
			rollbackTransaction: jest.fn().mockResolvedValue(undefined),
			release: jest.fn().mockResolvedValue(undefined),
			isTransactionActive: true,
			query: jest.fn(),
		};
		(dataSource.createQueryRunner as jest.Mock).mockReturnValue(mockQueryRunner);
		repository = new DeckDetailPostgresRepository();
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	const timeWindow: DeckDetailTimeWindow = {
		period: "2026H2",
		windowStart: "2026-07-01 00:00:00",
		windowEndExclusive: "2027-01-01 00:00:00",
		dataEndExclusive: "2026-09-30 16:00:00",
		isOngoing: true,
	};

	it("executes REPEATABLE READ transaction, reads snapshot and commits", async () => {
		// Mock responses for queries in order:
		// 1. SET TRANSACTION READ ONLY
		// 2. SELECT clock_timestamp() AS queried_at
		// 3. usage query
		// 4. matchup query
		// 5. top players query
		const fakeQueriedAt = new Date("2026-09-30T08:00:00.000Z");

		mockQueryRunner.query.mockImplementation((sql: string) => {
			if (sql.includes("clock_timestamp()")) {
				return Promise.resolve([{ queried_at: fakeQueriedAt }]);
			}
			if (sql.includes("SET TRANSACTION READ ONLY")) {
				return Promise.resolve([]);
			}
			if (sql.includes("GROUP BY v.deck_type_code")) {
				return Promise.resolve([
					{ deck_type_code: "D01", count: 20 },
					{ deck_type_code: "D02", count: 30 },
				]);
			}
			if (sql.includes("GROUP BY COALESCE(v.opp_deck_type_code, 'unknown')")) {
				return Promise.resolve([
					{
						opponent_code: "D02",
						matches: 12,
						match_wins: 6,
						first_matches: 5,
						first_wins: 3,
						second_matches: 5,
						second_wins: 2,
						unknown_seat_matches: 2,
						unknown_seat_wins: 1,
					},
					{
						opponent_code: "unknown",
						matches: 8,
						match_wins: 4,
						first_matches: 4,
						first_wins: 2,
						second_matches: 4,
						second_wins: 2,
						unknown_seat_matches: 0,
						unknown_seat_wins: 0,
					},
				]);
			}
			if (sql.includes("HAVING COUNT(*) >= 25")) {
				return Promise.resolve([
					{
						username: "MasterDuelist",
						matches: 30,
						wins: 24,
						losses: 6,
						win_rate: 0.8,
					},
				]);
			}
			return Promise.resolve([]);
		});

		const snapshot = await repository.getDeckDetailSnapshot("1109", "D01", timeWindow);

		expect(mockQueryRunner.connect).toHaveBeenCalledTimes(1);
		expect(mockQueryRunner.startTransaction).toHaveBeenCalledWith("REPEATABLE READ");
		expect(mockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);
		expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);

		expect(snapshot.queriedAt).toEqual(fakeQueriedAt);
		expect(snapshot.usageCounts).toEqual([
			{ deckTypeCode: "D01", count: 20 },
			{ deckTypeCode: "D02", count: 30 },
		]);
		expect(snapshot.matchups.length).toBe(2);
		expect(snapshot.matchups[0].opponentCode).toBe("D02");
		expect(snapshot.matchups[1].opponentCode).toBe("unknown");
		expect(snapshot.topPlayers).toEqual([
			{
				username: "MasterDuelist",
				matches: 30,
				wins: 24,
				losses: 6,
				winRate: 0.8,
			},
		]);
	});

	it("reads precomputed snapshot directly from precomputed tables when published run exists", async () => {
		const publishedAt = new Date("2026-09-29T16:00:00.000Z");

		mockQueryRunner.query.mockImplementation((sql: string) => {
			if (sql.includes("FROM usage_stat_runs")) {
				return Promise.resolve([{ published_at: publishedAt, data_end_exclusive: "2026-09-28" }]);
			}
			if (sql.includes("FROM stats_deck_detail_matchups") && sql.includes("COUNT(*)")) {
				return Promise.resolve([{ cnt: 30 }]);
			}
			if (sql.includes("FROM usage_deck_rows")) {
				return Promise.resolve([
					{ deck_type_code: "D01", count: 50 },
					{ deck_type_code: "D02", count: 40 },
				]);
			}
			if (sql.includes("FROM stats_deck_detail_matchups") && !sql.includes("COUNT(*)")) {
				return Promise.resolve([
					{
						opp_deck_type_code: "D02",
						matches: 10,
						match_wins: 6,
						first_matches: 5,
						first_wins: 3,
						second_matches: 4,
						second_wins: 2,
						unknown_seat_matches: 1,
						unknown_seat_wins: 1,
					},
				]);
			}
			if (sql.includes("FROM stats_deck_top_players")) {
				return Promise.resolve([
					{
						username: "ProDuelist",
						matches: 28,
						wins: 20,
						losses: 8,
						win_rate: 0.7143,
					},
				]);
			}
			return Promise.resolve([]);
		});

		const snapshot = await repository.getDeckDetailSnapshot("1109", "D01", timeWindow);

		expect(mockQueryRunner.connect).toHaveBeenCalledTimes(1);
		// Precomputed path does not start a transaction, avoiding CTE overhead
		expect(mockQueryRunner.startTransaction).not.toHaveBeenCalled();
		expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);

		expect(snapshot.queriedAt).toEqual(publishedAt);
		expect(snapshot.timeWindow.dataEndExclusive).toBe("2026-09-28");
		expect(snapshot.usageCounts).toEqual([
			{ deckTypeCode: "D01", count: 50 },
			{ deckTypeCode: "D02", count: 40 },
		]);
		expect(snapshot.matchups).toEqual([
			{
				opponentCode: "D02",
				matches: 10,
				matchWins: 6,
				firstMatches: 5,
				firstWins: 3,
				secondMatches: 4,
				secondWins: 2,
				unknownSeatMatches: 1,
				unknownSeatWins: 1,
			},
		]);
		expect(snapshot.topPlayers).toEqual([
			{
				username: "ProDuelist",
				matches: 28,
				wins: 20,
				losses: 8,
				winRate: 0.7143,
			},
		]);
	});

	it("rolls back transaction and releases connection on failure", async () => {
		mockQueryRunner.query.mockImplementation((sql: string) => {
			if (sql.includes("clock_timestamp()")) {
				return Promise.reject(new Error("DB Connection Error"));
			}
			return Promise.resolve([]);
		});

		await expect(repository.getDeckDetailSnapshot("1109", "D01", timeWindow)).rejects.toThrow(
			"DB Connection Error",
		);

		expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
		expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
	});
});
