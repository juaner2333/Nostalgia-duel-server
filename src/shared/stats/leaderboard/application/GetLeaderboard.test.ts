import { GetLeaderboard } from "./GetLeaderboard";
import { LeaderboardRepository } from "../domain/LeaderboardRepository";
import { NostalgiaFormat } from "@ygopro/room/domain/NostalgiaFormat";

describe("GetLeaderboard UseCase", () => {
	let repository: jest.Mocked<LeaderboardRepository>;
	let useCase: GetLeaderboard;

	beforeEach(() => {
		repository = {
			getSeasonLeaderboard: jest.fn(),
			getOverallLeaderboard: jest.fn(),
			getPlayerMonthlyStats: jest.fn(),
		};
		useCase = new GetLeaderboard(repository);
	});

	it("rejects unknown formats", async () => {
		await expect(useCase.run({ format: "unknown", scope: "overall" })).rejects.toThrow(
			"Invalid format",
		);
	});

	it("rejects season scope without valid YYYY-MM season parameter", async () => {
		await expect(
			useCase.run({ format: "1109", scope: "season", season: "invalid" }),
		).rejects.toThrow("Invalid season");
	});

	it("returns sorted season leaderboard for 1109", async () => {
		repository.getSeasonLeaderboard.mockResolvedValue([
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

		const result = await useCase.run({
			format: "1109",
			scope: "season",
			season: "2026-09",
		});

		expect(result.format).toBe("1109");
		expect(result.scope).toBe("season");
		expect(result.season).toBe("2026-09");
		expect(result.leaderboard).toHaveLength(2);
		expect(result.leaderboard[0].rank).toBe(1);
	});

	it("returns overall leaderboard across all seasons", async () => {
		repository.getOverallLeaderboard.mockResolvedValue([
			{
				rank: 1,
				userId: "u1",
				username: "Player1",
				points: 50,
				wins: 25,
				losses: 5,
				winRate: 0.8333,
			},
		]);

		const result = await useCase.run({
			format: "1103",
			scope: "overall",
		});

		expect(result.format).toBe("1103");
		expect(result.scope).toBe("overall");
		expect(result.leaderboard).toHaveLength(1);
	});

	it("rejects overall scope when season parameter is provided", async () => {
		await expect(
			useCase.run({ format: "1103", scope: "overall", season: "2026-09" }),
		).rejects.toThrow("The 'season' parameter is not allowed when scope is 'overall'");
	});
});
