import { Request, Response } from "express";
import { config } from "src/config";
import {
	DeckDetailNotFoundError,
	GetDeckDetail,
} from "src/shared/stats/deck-detail/application/GetDeckDetail";
import { GetDeckDetailController } from "./GetDeckDetailController";
import { DeckDetailDto } from "src/shared/stats/deck-detail/domain/DeckDetailDto";

describe("GetDeckDetailController (Task 3.2)", () => {
	let getDeckDetail: jest.Mocked<GetDeckDetail>;
	let controller: GetDeckDetailController;
	let req: Partial<Request>;
	let res: Partial<Response>;
	let statusMock: jest.Mock;
	let jsonMock: jest.Mock;
	let setHeaderMock: jest.Mock;

	const sampleDto: DeckDetailDto = {
		format: "1109",
		period: "2026H2",
		timezone: "Asia/Shanghai",
		windowStart: "2026-07-01 00:00:00",
		windowEndExclusive: "2027-01-01 00:00:00",
		dataEndExclusive: "2026-09-30 16:00:00",
		queriedAt: "2026-09-30T08:00:00.000Z",
		catalog: [{ code: "D01", nameZh: "代行天使" }],
		hasNamedCatalog: true,
		selected: { code: "D01", nameZh: "代行天使" },
		candidates: [{ code: "D01", nameZh: "代行天使" }],
		searchQuery: null,
		notFound: false,
		usage: { count: 20, denominator: 50, rate: 0.4 },
		total: {
			opponentCode: "TOTAL",
			opponentNameZh: "合计（不含其他，含未知对手）",
			matches: 20,
			matchWins: 12,
			firstMatches: 10,
			firstWins: 6,
			secondMatches: 8,
			secondWins: 5,
			unknownSeatMatches: 2,
			unknownSeatWins: 1,
			matchWinRate: 0.6,
			firstWinRate: 0.6,
			secondWinRate: 0.625,
		},
		matchups: [],
		minPlayerMatches: 25,
		topPlayers: [
			{
				rank: 1,
				username: "DuelKing",
				matches: 30,
				wins: 25,
				losses: 5,
				winRate: 0.8333,
			},
		],
	};

	beforeEach(() => {
		config.ranking.enabled = true;

		getDeckDetail = {
			execute: jest.fn().mockResolvedValue(sampleDto),
		} as any;

		controller = new GetDeckDetailController(getDeckDetail);

		statusMock = jest.fn().mockReturnThis();
		jsonMock = jest.fn().mockReturnThis();
		setHeaderMock = jest.fn().mockReturnThis();

		req = {
			params: { format: "1109" },
			query: { deckTypeCode: "D01", period: "2026H2" },
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
		expect(jsonMock).toHaveBeenCalledWith({
			success: false,
			error: "Deck detail is currently unavailable (ranking disabled)",
		});
	});

	it("returns 404 for unknown format", async () => {
		req.params = { format: "9999" };

		await controller.run(req as Request, res as Response);

		expect(statusMock).toHaveBeenCalledWith(404);
		expect(jsonMock).toHaveBeenCalledWith({
			success: false,
			error: "Unknown format: 9999",
		});
	});

	it("returns 400 when array parameters are passed", async () => {
		req.query = { period: ["2026H1", "2026H2"] as any };

		await controller.run(req as Request, res as Response);

		expect(statusMock).toHaveBeenCalledWith(400);
		expect(jsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				error: expect.stringContaining("不支持数组参数"),
			}),
		);
	});

	it("returns 400 when both deckTypeCode and q are submitted", async () => {
		req.query = { deckTypeCode: "D01", q: "代行" };
		getDeckDetail.execute.mockRejectedValueOnce(new Error("不能同时指定卡组类型代码与搜索关键词"));

		await controller.run(req as Request, res as Response);

		expect(statusMock).toHaveBeenCalledWith(400);
		expect(jsonMock).toHaveBeenCalledWith({
			success: false,
			error: "不能同时指定卡组类型代码与搜索关键词",
		});
	});

	it("returns 404 when deckTypeCode does not exist", async () => {
		req.query = { deckTypeCode: "D99" };
		getDeckDetail.execute.mockRejectedValueOnce(new DeckDetailNotFoundError("未找到卡组类型: D99"));

		await controller.run(req as Request, res as Response);

		expect(statusMock).toHaveBeenCalledWith(404);
		expect(jsonMock).toHaveBeenCalledWith({
			success: false,
			error: "未找到卡组类型: D99",
		});
	});

	it("successfully returns 200 with standard { success: true, data } wrapping and no-cache headers", async () => {
		await controller.run(req as Request, res as Response);

		expect(setHeaderMock).toHaveBeenCalledWith(
			"Cache-Control",
			"no-cache, no-store, must-revalidate",
		);
		expect(statusMock).toHaveBeenCalledWith(200);
		expect(jsonMock).toHaveBeenCalledWith({
			success: true,
			data: sampleDto,
		});

		// Verify sensitive fields are not in data
		const jsonResult = jsonMock.mock.calls[0][0];
		expect(jsonResult.data.topPlayers[0].id).toBeUndefined();
		expect(jsonResult.data.topPlayers[0].userId).toBeUndefined();
		expect(jsonResult.data.topPlayers[0].email).toBeUndefined();
		expect(jsonResult.data.topPlayers[0].password).toBeUndefined();
	});
});
