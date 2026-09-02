import { GetLeaderboardController } from "./GetLeaderboardController";
import { GetLeaderboard } from "@shared/stats/leaderboard/application/GetLeaderboard";
import { Request, Response } from "express";
import { config } from "src/config";

describe("GetLeaderboardController", () => {
	let controller: GetLeaderboardController;
	let getLeaderboard: jest.Mocked<GetLeaderboard>;
	let req: Partial<Request>;
	let res: Partial<Response>;
	const originalRanking = config.ranking.enabled;

	beforeEach(() => {
		config.ranking.enabled = true;
		getLeaderboard = {
			run: jest.fn(),
		} as any;
		controller = new GetLeaderboardController(getLeaderboard);
		res = {
			status: jest.fn().mockReturnThis(),
			json: jest.fn().mockReturnThis(),
		};
	});

	afterEach(() => {
		config.ranking.enabled = originalRanking;
	});

	it("returns 503 when ranking is disabled", async () => {
		config.ranking.enabled = false;
		req = {
			params: { format: "1109" },
			query: { scope: "season", season: "2026-09" },
		};

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(503);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining("ranking disabled"),
			}),
		);
	});

	it("returns 200 with leaderboard data for valid query", async () => {
		req = {
			params: { format: "1109" },
			query: { scope: "season", season: "2026-09" },
		};

		getLeaderboard.run.mockResolvedValue({
			format: "1109",
			scope: "season",
			season: "2026-09",
			leaderboard: [],
		});

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			format: "1109",
			scope: "season",
			season: "2026-09",
			leaderboard: [],
		});
	});

	it("returns 400 when format or query parameters are invalid", async () => {
		req = {
			params: { format: "invalid" },
			query: { scope: "season" },
		};

		getLeaderboard.run.mockRejectedValue(new Error("Invalid format"));

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: "Invalid format",
		});
	});

	it("returns 400 when scope is missing", async () => {
		req = {
			params: { format: "1109" },
			query: {},
		};

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining("Missing or invalid 'scope'"),
			}),
		);
	});

	it("returns 400 when scope is overall and season is provided", async () => {
		req = {
			params: { format: "1109" },
			query: { scope: "overall", season: "2026-09" },
		};

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining("not allowed when scope is 'overall'"),
			}),
		);
	});
});
