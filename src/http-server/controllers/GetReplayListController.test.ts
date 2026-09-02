import { GetReplayListController } from "./GetReplayListController";
import { GetReplayList } from "@shared/stats/replays/application/GetReplayList";
import { Request, Response } from "express";
import { config } from "src/config";

describe("GetReplayListController", () => {
	let controller: GetReplayListController;
	let getReplayList: jest.Mocked<GetReplayList>;
	let req: Partial<Request>;
	let res: Partial<Response>;
	const originalRanking = config.ranking.enabled;

	beforeEach(() => {
		config.ranking.enabled = true;
		getReplayList = {
			run: jest.fn(),
		} as any;
		controller = new GetReplayListController(getReplayList);
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
			params: { format: "1103" },
			query: { page: "1", pageSize: "20" },
		};

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(503);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining("ranking disabled"),
			}),
		);
	});

	it("returns 200 with replay list data for valid query", async () => {
		req = {
			params: { format: "1103" },
			query: { page: "1", pageSize: "20", search: "Alice" },
		};

		getReplayList.run.mockResolvedValue({
			format: "1103",
			page: 1,
			pageSize: 20,
			total: 1,
			replays: [
				{
					replayId: "r-1",
					endedAt: "2026-09-02 23:45:10",
					player1Name: "Alice",
					player2Name: "Bob",
					size: 1024,
				},
			],
		});

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			format: "1103",
			page: 1,
			pageSize: 20,
			total: 1,
			replays: [
				{
					replayId: "r-1",
					endedAt: "2026-09-02 23:45:10",
					player1Name: "Alice",
					player2Name: "Bob",
					size: 1024,
				},
			],
		});
	});

	it("returns 400 when format is invalid", async () => {
		req = {
			params: { format: "invalid" },
			query: {},
		};

		getReplayList.run.mockRejectedValue(new Error("Invalid format: invalid"));

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: "Invalid format: invalid",
		});
	});
});
