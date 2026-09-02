import { LeaderboardPostgresRepository, escapeLike } from "./LeaderboardPostgresRepository";
import { dataSource } from "../../../../../evolution-types/src/data-source";

jest.mock("../../../../../evolution-types/src/data-source", () => ({
	dataSource: {
		query: jest.fn(),
	},
}));

describe("LeaderboardPostgresRepository", () => {
	let repository: LeaderboardPostgresRepository;

	beforeEach(() => {
		repository = new LeaderboardPostgresRepository();
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it("escapes LIKE wildcards correctly", () => {
		expect(escapeLike("100%_hero")).toBe("100\\%\\_hero");
	});

	it("queries season leaderboard and calculates winRate and rank", async () => {
		(dataSource.query as jest.Mock).mockResolvedValue([
			{
				userId: "u1",
				username: "Player1",
				points: 10,
				wins: 5,
				losses: 1,
				rank: 1,
				totalCount: 2,
			},
			{
				userId: "u2",
				username: "Player2",
				points: 5,
				wins: 3,
				losses: 2,
				rank: 2,
				totalCount: 2,
			},
		]);

		const result = await repository.getSeasonLeaderboard("1109", 202609);

		expect(dataSource.query).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			total: 2,
			entries: [
				{
					rank: 1,
					userId: "u1",
					username: "Player1",
					points: 10,
					wins: 5,
					losses: 1,
					winRate: 0.8333,
				},
				{
					rank: 2,
					userId: "u2",
					username: "Player2",
					points: 5,
					wins: 3,
					losses: 2,
					winRate: 0.6,
				},
			],
		});
	});

	it("queries overall leaderboard and aggregates stats", async () => {
		(dataSource.query as jest.Mock).mockResolvedValue([
			{
				userId: "u1",
				username: "Player1",
				points: "25",
				wins: "12",
				losses: "3",
				rank: 1,
				totalCount: 1,
			},
		]);

		const result = await repository.getOverallLeaderboard("1103");

		expect(dataSource.query).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			total: 1,
			entries: [
				{
					rank: 1,
					userId: "u1",
					username: "Player1",
					points: 25,
					wins: 12,
					losses: 3,
					winRate: 0.8,
				},
			],
		});
	});

	it("queries season leaderboard with search and pagination", async () => {
		(dataSource.query as jest.Mock).mockResolvedValue([
			{
				userId: "u5",
				username: "AliceHero",
				points: 30,
				wins: 15,
				losses: 3,
				rank: 5,
				totalCount: 1,
			},
		]);

		const result = await repository.getSeasonLeaderboard("1103", 202609, {
			search: "Alice",
			page: 1,
			pageSize: 50,
		});

		expect(result.total).toBe(1);
		expect(result.entries[0].rank).toBe(5);
		expect(result.entries[0].username).toBe("AliceHero");
	});

	it("gets player monthly stats when player exists in season list", async () => {
		(dataSource.query as jest.Mock).mockResolvedValue([
			{
				userId: "u1",
				username: "Player1",
				points: 10,
				wins: 5,
				losses: 1,
				rank: 1,
				totalCount: 2,
			},
			{
				userId: "u2",
				username: "Player2",
				points: 5,
				wins: 3,
				losses: 2,
				rank: 2,
				totalCount: 2,
			},
		]);

		const stats = await repository.getPlayerMonthlyStats("u2", "1109", 202609);

		expect(stats).toEqual({
			format: "1109",
			season: "2026-09",
			points: 5,
			wins: 3,
			losses: 2,
			winRate: 0.6,
			rank: 2,
		});
	});

	it("returns unranked default stats when player is not in season list", async () => {
		(dataSource.query as jest.Mock).mockResolvedValue([]);

		const stats = await repository.getPlayerMonthlyStats("u-none", "1109", 202609);

		expect(stats).toEqual({
			format: "1109",
			season: "2026-09",
			points: 0,
			wins: 0,
			losses: 0,
			winRate: 0,
			rank: null,
		});
	});
});
