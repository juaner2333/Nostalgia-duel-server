import { GetReplayListController } from "./GetReplayListController";
import { GetReplayList } from "@shared/stats/replays/application/GetReplayList";
import { ReplayListResponse } from "@shared/stats/replays/domain/Replay";
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

		const mockResult: ReplayListResponse = {
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
					winner: "Alice",
					size: 1024,
					duelIndex: 1,
					players: [
						{
							name: "Alice",
							deckTypeCode: "OTHERS",
							deckTypeNameZh: "其他",
							deckCompleteness: "complete" as const,
							deckDownloadUrl: "/api/ladder/1103/matches/m-1/deck",
						},
						{
							name: "Bob",
							deckTypeCode: "OTHERS",
							deckTypeNameZh: "其他",
							deckCompleteness: "complete" as const,
							deckDownloadUrl: "/api/ladder/1103/matches/m-2/deck",
						},
					],
				},
			],
			deckTypes: [{ code: "OTHERS", nameZh: "其他" }],
		};

		getReplayList.run.mockResolvedValue(mockResult);

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(mockResult);
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

	it("passes deckTypeCode to GetReplayList use case", async () => {
		req = {
			params: { format: "1109" },
			query: { deckTypeCode: "D01" },
		};

		getReplayList.run.mockResolvedValue({
			format: "1109",
			page: 1,
			pageSize: 20,
			total: 0,
			replays: [],
			deckTypes: [{ code: "D01", nameZh: "代行天使" }],
		});

		await controller.run(req as Request, res as Response);

		expect(getReplayList.run).toHaveBeenCalledWith({
			format: "1109",
			page: undefined,
			pageSize: undefined,
			search: undefined,
			deckTypeCode: "D01",
		});
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it("returns 400 when deckTypeCode is invalid", async () => {
		req = {
			params: { format: "1103" },
			query: { deckTypeCode: "D01" },
		};

		getReplayList.run.mockRejectedValue(new Error("Invalid deck type code 'D01' for format 1103"));

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: "Invalid deck type code 'D01' for format 1103",
		});
	});
});
