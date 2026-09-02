import { LeaderboardPostgresRepository } from "./LeaderboardPostgresRepository";
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

	it("queries season leaderboard and calculates winRate and rank", async () => {
		(dataSource.query as jest.Mock).mockResolvedValue([
			{
				userId: "u1",
				username: "Player1",
				points: 10,
				wins: 5,
				losses: 1,
			},
			{
				userId: "u2",
				username: "Player2",
				points: 5,
				wins: 3,
				losses: 2,
			},
		]);

		const result = await repository.getSeasonLeaderboard("1109", 202609);

		expect(dataSource.query).toHaveBeenCalledTimes(1);
		expect(result).toEqual([
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
		]);
	});

	it("queries overall leaderboard and aggregates stats", async () => {
		(dataSource.query as jest.Mock).mockResolvedValue([
			{
				userId: "u1",
				username: "Player1",
				points: "25",
				wins: "12",
				losses: "3",
			},
		]);

		const result = await repository.getOverallLeaderboard("1103");

		expect(dataSource.query).toHaveBeenCalledTimes(1);
		expect(result).toEqual([
			{
				rank: 1,
				userId: "u1",
				username: "Player1",
				points: 25,
				wins: 12,
				losses: 3,
				winRate: 0.8,
			},
		]);
	});

	it("gets player monthly stats when player exists in season list", async () => {
		(dataSource.query as jest.Mock).mockResolvedValue([
			{
				userId: "u1",
				username: "Player1",
				points: 10,
				wins: 5,
				losses: 1,
			},
			{
				userId: "u2",
				username: "Player2",
				points: 5,
				wins: 3,
				losses: 2,
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
