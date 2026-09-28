import {
	calculateBeijingHalfYear,
	calculateBeijingSeason,
	parseHalfYearSeason,
} from "src/utils/calculateBeijingSeason";
import { LeaderboardPostgresRepository } from "./infrastructure/postgres/LeaderboardPostgresRepository";
import { GetLeaderboard } from "./application/GetLeaderboard";
import { dataSource } from "../../../evolution-types/src/data-source";

jest.mock("../../../evolution-types/src/data-source", () => ({
	dataSource: {
		query: jest.fn(),
	},
}));

describe("Leaderboard Half-Year Fixed Sample Verification (Task 4.1)", () => {
	const june30End = new Date("2026-06-30T23:59:59+08:00");
	const july1Start = new Date("2026-07-01T00:00:00+08:00");

	it("classifies June 30 and July 1 match timestamps correctly across season boundaries", () => {
		expect(calculateBeijingSeason(june30End)).toBe(202606);
		expect(calculateBeijingSeason(july1Start)).toBe(202607);

		const h1 = calculateBeijingHalfYear(june30End);
		expect(h1.label).toBe("2026H1");
		expect(h1.startMonth).toBe(202601);
		expect(h1.endMonth).toBe(202606);
		expect(h1.months).toEqual([202601, 202602, 202603, 202604, 202605, 202606]);

		const h2 = calculateBeijingHalfYear(july1Start);
		expect(h2.label).toBe("2026H2");
		expect(h2.startMonth).toBe(202607);
		expect(h2.endMonth).toBe(202612);
		expect(h2.months).toEqual([202607, 202608, 202609, 202610, 202611, 202612]);
	});

	it("verifies numerical consistency for 2026H1, 2026H2, overall and in-room stats", async () => {
		const repository = new LeaderboardPostgresRepository();
		const getLeaderboard = new GetLeaderboard(repository);

		// Fixed sample:
		// Player A (u1):
		// 202601: 10 pts, 1 win, 0 loss
		// 202603: 20 pts, 2 wins, 0 loss
		// 202606: 15 pts, 1 win, 1 loss (ended 2026-06-30 23:59:59)
		// -> H1 total: 45 pts, 4 wins, 1 loss, winRate = 0.8
		//
		// 202607: 30 pts, 3 wins, 0 loss (ended 2026-07-01 00:00:00)
		// -> H2 total: 30 pts, 3 wins, 0 loss, winRate = 1.0
		//
		// Overall: 75 pts, 7 wins, 1 loss, winRate = 0.875

		// 1. Test 2026H1 leaderboard query
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				userId: "u1",
				username: "PlayerA",
				points: 45,
				wins: 4,
				losses: 1,
				rank: 1,
				totalCount: 1,
			},
		]);

		const resH1 = await getLeaderboard.run({
			format: "1109",
			scope: "season",
			season: "2026H1",
		});

		expect(resH1.season).toBe("2026H1");
		expect(resH1.leaderboard[0]).toEqual({
			rank: 1,
			userId: "u1",
			username: "PlayerA",
			points: 45,
			wins: 4,
			losses: 1,
			winRate: 0.8,
		});

		// 2. Test 2026H2 leaderboard query
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				userId: "u1",
				username: "PlayerA",
				points: 30,
				wins: 3,
				losses: 0,
				rank: 1,
				totalCount: 1,
			},
		]);

		const resH2 = await getLeaderboard.run({
			format: "1109",
			scope: "season",
			season: "2026H2",
		});

		expect(resH2.season).toBe("2026H2");
		expect(resH2.leaderboard[0]).toEqual({
			rank: 1,
			userId: "u1",
			username: "PlayerA",
			points: 30,
			wins: 3,
			losses: 0,
			winRate: 1.0,
		});

		// 3. Test Overall leaderboard query
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				userId: "u1",
				username: "PlayerA",
				points: 75,
				wins: 7,
				losses: 1,
				rank: 1,
				totalCount: 1,
			},
		]);

		const resOverall = await getLeaderboard.run({
			format: "1109",
			scope: "overall",
		});

		expect(resOverall.scope).toBe("overall");
		expect(resOverall.season).toBeUndefined();
		expect(resOverall.leaderboard[0]).toEqual({
			rank: 1,
			userId: "u1",
			username: "PlayerA",
			points: 75,
			wins: 7,
			losses: 1,
			winRate: 0.875,
		});

		// 4. Test In-Room Personal Stats matching 2026H1
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				userId: "u1",
				username: "PlayerA",
				points: 45,
				wins: 4,
				losses: 1,
				rank: 1,
				totalCount: 1,
			},
		]);

		const personalH1 = await repository.getPlayerSeasonStats("u1", "1109", "2026H1");
		expect(personalH1).toEqual({
			format: "1109",
			season: "2026H1",
			points: 45,
			wins: 4,
			losses: 1,
			winRate: 0.8,
			rank: 1,
		});

		// 5. Test In-Room Personal Stats for a player with zero records in 2026H2
		(dataSource.query as jest.Mock).mockResolvedValueOnce([]);
		const personalH2Unranked = await repository.getPlayerSeasonStats(
			"u2-unranked",
			"1109",
			"2026H2",
		);
		expect(personalH2Unranked).toEqual({
			format: "1109",
			season: "2026H2",
			points: 0,
			wins: 0,
			losses: 0,
			winRate: 0,
			rank: null,
		});
	});
});
