import { Request, Response } from "express";
import { config } from "src/config";
import { GetDeckStatsPeriodsController } from "./GetDeckStatsPeriodsController";
import { GetDeckMatchupStatsUseCase } from "@shared/stats/matchup/application/GetDeckMatchupStatsUseCase";

describe("GetDeckStatsPeriodsController (Task 5.2)", () => {
	let controller: GetDeckStatsPeriodsController;
	let useCase: jest.Mocked<GetDeckMatchupStatsUseCase>;
	let req: Partial<Request>;
	let res: Partial<Response>;
	const originalRanking = config.ranking.enabled;

	beforeEach(() => {
		config.ranking.enabled = true;
		useCase = {
			execute: jest.fn(),
			getPeriods: jest.fn(),
		} as any;
		controller = new GetDeckStatsPeriodsController(useCase);
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
		req = { params: { format: "1109" } };

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(503);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining("disabled"),
			}),
		);
	});

	it("returns 404 when format is not 1109", async () => {
		req = { params: { format: "1103" } };

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining("Only 1109 is supported"),
			}),
		);
	});

	it("returns 200 with list of periods", async () => {
		useCase.getPeriods.mockResolvedValueOnce({
			format: "1109",
			periods: ["2026H2", "2026H1"],
		});
		req = { params: { format: "1109" } };

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			format: "1109",
			periods: ["2026H2", "2026H1"],
		});
	});
});
