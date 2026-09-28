import { Request, Response } from "express";
import { config } from "src/config";
import { GetUsagePeriodsController } from "./GetUsagePeriodsController";
import { GetUsageStatisticsUseCase } from "@shared/stats/usage/application/GetUsageStatisticsUseCase";

describe("GetUsagePeriodsController", () => {
	let controller: GetUsagePeriodsController;
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
		controller = new GetUsagePeriodsController(useCase);
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
		};

		await controller.run(req as Request, res as Response);
		expect(res.status).toHaveBeenCalledWith(503);
	});

	it("returns 404 when format is invalid", async () => {
		req = {
			params: { format: "invalid" },
		};

		await controller.run(req as Request, res as Response);
		expect(res.status).toHaveBeenCalledWith(404);
	});

	it("returns 200 with periods list when valid", async () => {
		req = {
			params: { format: "1109" },
		};
		const mockPeriods = {
			format: "1109",
			periods: [
				{
					period: "2026H2",
					windowStart: "2026-07-01",
					windowEndExclusive: "2027-01-01",
					dataEndExclusive: "2026-09-27",
					publishedAt: new Date().toISOString(),
					isFinalized: false,
				},
			],
		};
		useCase.getPeriods.mockResolvedValue(mockPeriods);

		await controller.run(req as Request, res as Response);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(mockPeriods);
	});
});
