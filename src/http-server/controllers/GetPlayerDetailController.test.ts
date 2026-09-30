import { Request, Response } from "express";
import { config } from "src/config";
import {
	GetPlayerDetail,
	PlayerDetailRateLimitExceededError,
} from "src/shared/stats/player-detail/application/GetPlayerDetail";
import { GetPlayerDetailController } from "./GetPlayerDetailController";

describe("GetPlayerDetailController", () => {
	let getPlayerDetail: jest.Mocked<GetPlayerDetail>;
	let controller: GetPlayerDetailController;
	let req: Partial<Request>;
	let res: Partial<Response>;
	let statusMock: jest.Mock;
	let jsonMock: jest.Mock;
	let setHeaderMock: jest.Mock;

	beforeEach(() => {
		config.ranking.enabled = true;

		getPlayerDetail = {
			execute: jest.fn(),
		} as any;

		controller = new GetPlayerDetailController(getPlayerDetail);

		statusMock = jest.fn().mockReturnThis();
		jsonMock = jest.fn().mockReturnThis();
		setHeaderMock = jest.fn().mockReturnThis();

		req = {
			params: { format: "1103" },
			body: { player: "武藤游戏" },
			ip: "127.0.0.1",
		};

		res = {
			status: statusMock,
			json: jsonMock,
			setHeader: setHeaderMock,
		};
	});

	it("returns 503 when ranking is disabled", async () => {
		config.ranking.enabled = false;

		await controller.run(req as Request, res as Response);

		expect(statusMock).toHaveBeenCalledWith(503);
		expect(jsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				error: expect.stringContaining("ranking disabled"),
			}),
		);
	});

	it("returns 404 for unknown format", async () => {
		req.params = { format: "9999" };

		await controller.run(req as Request, res as Response);

		expect(statusMock).toHaveBeenCalledWith(404);
		expect(jsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				error: expect.stringContaining("Unknown format"),
			}),
		);
	});

	it("returns 400 when player name is missing", async () => {
		req.body = { player: "  " };
		getPlayerDetail.execute.mockRejectedValueOnce(new Error("玩家昵称不能为空"));

		await controller.run(req as Request, res as Response);

		expect(statusMock).toHaveBeenCalledWith(400);
		expect(jsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
			}),
		);
	});

	it("returns 429 when rate limit is exceeded", async () => {
		getPlayerDetail.execute.mockRejectedValueOnce(new PlayerDetailRateLimitExceededError());

		await controller.run(req as Request, res as Response);

		expect(statusMock).toHaveBeenCalledWith(429);
		expect(jsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				error: expect.stringContaining("过于频繁"),
			}),
		);
	});

	it("returns 200 with no-store cache headers on successful execution", async () => {
		const mockResult = {
			found: true,
			player: "武藤游戏",
			format: "1103",
			scope: "season" as const,
			season: "2026H1",
			isVerified: false,
			authFailed: false,
			overallSummary: null,
			overallDeckStats: [],
			seasonSummary: null,
			seasonDeckStats: null,
			ratingTrend: [],
			matches: [],
			pagination: { page: 1, pageSize: 20, total: 0 },
		};
		getPlayerDetail.execute.mockResolvedValueOnce(mockResult);

		await controller.run(req as Request, res as Response);

		expect(setHeaderMock).toHaveBeenCalledWith(
			"Cache-Control",
			"no-cache, no-store, must-revalidate",
		);
		expect(statusMock).toHaveBeenCalledWith(200);
		expect(jsonMock).toHaveBeenCalledWith({
			success: true,
			data: mockResult,
		});
	});
});
