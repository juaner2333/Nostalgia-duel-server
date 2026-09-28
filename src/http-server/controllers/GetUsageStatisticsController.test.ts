import { Request, Response } from "express";
import { config } from "src/config";
import { GetUsageStatisticsController } from "./GetUsageStatisticsController";
import { GetUsageStatisticsUseCase } from "@shared/stats/usage/application/GetUsageStatisticsUseCase";

describe("GetUsageStatisticsController", () => {
	let controller: GetUsageStatisticsController;
	let useCase: jest.Mocked<GetUsageStatisticsUseCase>;
	let req: Partial<Request>;
	let res: Partial<Response>;
	const originalRanking = config.ranking.enabled;

	beforeEach(() => {
		config.ranking.enabled = true;
		useCase = {
			getUsage: jest.fn(),
			getPeriods: jest.fn(),
		} as any;
		controller = new GetUsageStatisticsController(useCase);
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
			query: { metric: "deck" },
		};

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(503);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining("disabled"),
			}),
		);
	});

	it("returns 404 when format is not 1103 or 1109", async () => {
		req = {
			params: { format: "edopro" },
			query: { metric: "deck" },
		};

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining("format"),
			}),
		);
	});

	it("returns 400 when metric is missing or invalid", async () => {
		req = {
			params: { format: "1109" },
			query: {},
		};

		await controller.run(req as Request, res as Response);
		expect(res.status).toHaveBeenCalledWith(400);

		req.query = { metric: "unknown" };
		await controller.run(req as Request, res as Response);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it("returns 400 when period is invalid format", async () => {
		req = {
			params: { format: "1109" },
			query: { metric: "deck", period: "2026-09" },
		};

		await controller.run(req as Request, res as Response);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it("returns 400 when page or pageSize is invalid", async () => {
		req = {
			params: { format: "1109" },
			query: { metric: "deck", page: "0" },
		};
		await controller.run(req as Request, res as Response);
		expect(res.status).toHaveBeenCalledWith(400);

		req.query = { metric: "deck", pageSize: "200" };
		await controller.run(req as Request, res as Response);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it("returns 404 when useCase throws period not ready/found", async () => {
		req = {
			params: { format: "1109" },
			query: { metric: "deck", period: "2025H1" },
		};
		useCase.getUsage.mockRejectedValue(new Error("Usage statistics not ready for format 1109"));

		await controller.run(req as Request, res as Response);
		expect(res.status).toHaveBeenCalledWith(404);
	});

	it("returns 200 with result when query is valid", async () => {
		req = {
			params: { format: "1109" },
			query: { metric: "deck" },
		};
		const mockResult = {
			format: "1109",
			metric: "deck",
			period: "2026H2",
			windowStart: "2026-07-01",
			windowEndExclusive: "2027-01-01",
			dataEndExclusive: "2026-09-27",
			timezone: "Asia/Shanghai",
			publishedAt: new Date().toISOString(),
			totalDecks: 10,
			sideKnownDecks: 8,
			denominator: 10,
			total: 1,
			page: 1,
			pageSize: 50,
			decks: [],
		};
		useCase.getUsage.mockResolvedValue(mockResult);

		await controller.run(req as Request, res as Response);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(mockResult);
	});
});
