import { Request, Response } from "express";
import { config } from "src/config";
import { GetDeckStatsController } from "./GetDeckStatsController";
import {
	GetDeckMatchupStatsUseCase,
	FormatNotSupportedError,
	StatsNotReadyError,
} from "@shared/stats/matchup/application/GetDeckMatchupStatsUseCase";

describe("GetDeckStatsController (Task 5.2)", () => {
	let controller: GetDeckStatsController;
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
		controller = new GetDeckStatsController(useCase);
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
			query: {},
		};

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(503);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining("disabled"),
			}),
		);
		expect(useCase.execute).not.toHaveBeenCalled();
	});

	it("returns 404 when format is not 1109 (e.g. 1103)", async () => {
		req = {
			params: { format: "1103" },
			query: {},
		};

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining("Only 1109 is supported"),
			}),
		);
		expect(useCase.execute).not.toHaveBeenCalled();
	});

	it("returns 400 when period is invalid format", async () => {
		req = {
			params: { format: "1109" },
			query: { period: "2026-09" },
		};

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining("Invalid 'period' parameter"),
			}),
		);
		expect(useCase.execute).not.toHaveBeenCalled();
	});

	it("returns 404 when batch is not ready (StatsNotReadyError)", async () => {
		req = {
			params: { format: "1109" },
			query: { period: "2026H1" },
		};
		useCase.execute.mockRejectedValueOnce(new StatsNotReadyError("2026H1"));

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining("not ready"),
			}),
		);
	});

	it("returns 200 with stats matrix and no sensitive player fields on success", async () => {
		const mockResponse = {
			format: "1109",
			period: "2026H2",
			windowStart: "2026-07-01",
			windowEndExclusive: "2027-01-01",
			dataEndExclusive: "2026-09-28",
			timezone: "Asia/Shanghai",
			publishedAt: "2026-09-28T03:00:00.000Z",
			totalPhysicalMatches: 10,
			candidateUsageDecks: 25,
			decks: [{ code: "D01", nameZh: "代行天使", deckCount: 25 }],
			stats: {
				"D01::D01": {
					matches: 20,
					matchWins: 10,
					firstMatches: 10,
					firstWins: 5,
					secondMatches: 10,
					secondWins: 5,
				},
				"D01::TOP16": {
					matches: 20,
					matchWins: 10,
					firstMatches: 10,
					firstWins: 5,
					secondMatches: 10,
					secondWins: 5,
				},
			},
		};
		useCase.execute.mockResolvedValueOnce(mockResponse);

		req = {
			params: { format: "1109" },
			query: {},
		};

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(mockResponse);

		const responseJson = JSON.stringify(mockResponse);
		expect(responseJson).not.toContain("userId");
		expect(responseJson).not.toContain("playerNames");
		expect(responseJson).not.toContain("replayData");
	});
});
