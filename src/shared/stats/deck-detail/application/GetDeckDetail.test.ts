import { DeckDetailNotFoundError, GetDeckDetail } from "./GetDeckDetail";
import {
	DeckDetailRawSnapshot,
	DeckDetailRepository,
	DeckDetailTimeWindow,
} from "../domain/DeckDetailRepository";
import { Logger } from "src/shared/logger/domain/Logger";

describe("GetDeckDetail UseCase (Task 3.1)", () => {
	let mockRepo: jest.Mocked<DeckDetailRepository>;
	let mockLogger: jest.Mocked<Logger>;
	let useCase: GetDeckDetail;
	const fixedNow = new Date("2026-09-30T12:00:00.000Z");

	const sampleTimeWindow: DeckDetailTimeWindow = {
		period: "2026H2",
		windowStart: "2026-07-01 00:00:00",
		windowEndExclusive: "2027-01-01 00:00:00",
		dataEndExclusive: "2026-09-30 20:00:00",
		isOngoing: true,
	};

	const sampleSnapshot: DeckDetailRawSnapshot = {
		queriedAt: fixedNow,
		timeWindow: sampleTimeWindow,
		usageCounts: [
			{ deckTypeCode: "D01", count: 20 },
			{ deckTypeCode: "D02", count: 30 },
		],
		matchups: [
			{
				opponentCode: "D02",
				matches: 20,
				matchWins: 12,
				firstMatches: 10,
				firstWins: 6,
				secondMatches: 8,
				secondWins: 5,
				unknownSeatMatches: 2,
				unknownSeatWins: 1,
			},
		],
		topPlayers: [
			{
				username: "TopPlayer1",
				matches: 30,
				wins: 25,
				losses: 5,
				winRate: 25 / 30,
			},
		],
	};

	beforeEach(() => {
		mockRepo = {
			getDeckDetailSnapshot: jest.fn().mockResolvedValue(sampleSnapshot),
		};
		mockLogger = {
			info: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn(),
			child: jest.fn().mockReturnThis(),
		};
		useCase = new GetDeckDetail(mockRepo, mockLogger);
	});

	it("returns catalog and selected=null when no code or search is provided, without scanning repository", async () => {
		const result = await useCase.execute({ format: "1109" }, fixedNow);

		expect(mockRepo.getDeckDetailSnapshot).not.toHaveBeenCalled();
		expect(result.format).toBe("1109");
		expect(result.period).toBe("2026H2");
		expect(result.selected).toBeNull();
		expect(result.notFound).toBe(false);
		expect(result.candidates.length).toBe(30);
		expect(result.catalog.length).toBe(30);
		expect(result.usage).toBeNull();
		expect(result.total).toBeNull();
		expect(result.matchups).toEqual([]);
		expect(result.topPlayers).toEqual([]);
	});

	it("returns candidates and does not scan repository when search query has multiple matches", async () => {
		const result = await useCase.execute({ format: "1109", q: "均" }, fixedNow);

		expect(mockRepo.getDeckDetailSnapshot).not.toHaveBeenCalled();
		expect(result.selected).toBeNull();
		expect(result.candidates.length).toBe(2);
		expect(result.candidates.map((c) => c.code)).toEqual(["D10", "D30"]);
		expect(result.searchQuery).toBe("均");
		expect(result.notFound).toBe(false);
	});

	it("returns notFound=true and does not scan repository when search query matches 0 deck types", async () => {
		const result = await useCase.execute({ format: "1109", q: "不存在的卡组" }, fixedNow);

		expect(mockRepo.getDeckDetailSnapshot).not.toHaveBeenCalled();
		expect(result.selected).toBeNull();
		expect(result.notFound).toBe(true);
		expect(result.candidates).toEqual([]);
	});

	it("auto-selects and scans repository when search query matches exactly 1 deck type", async () => {
		const result = await useCase.execute({ format: "1109", q: "代行" }, fixedNow);

		expect(mockRepo.getDeckDetailSnapshot).toHaveBeenCalledTimes(1);
		expect(mockRepo.getDeckDetailSnapshot).toHaveBeenCalledWith(
			"1109",
			"D01",
			expect.objectContaining({ period: "2026H2" }),
		);
		expect(result.selected).toEqual({ code: "D01", nameZh: "代行天使" });
		expect(result.usage?.count).toBe(20);
		expect(result.usage?.denominator).toBe(50);
		expect(result.usage?.rate).toBe(0.4);
		expect(result.total?.matches).toBe(20);
	});

	it("scans repository and returns full detail when deckTypeCode is directly specified", async () => {
		const result = await useCase.execute({ format: "1109", deckTypeCode: "D01" }, fixedNow);

		expect(mockRepo.getDeckDetailSnapshot).toHaveBeenCalledTimes(1);
		expect(result.selected).toEqual({ code: "D01", nameZh: "代行天使" });
		expect(result.usage?.count).toBe(20);
		expect(result.usage?.denominator).toBe(50);
		expect(result.usage?.rate).toBe(0.4);
		expect(result.total?.matches).toBe(20);
		expect(result.total?.opponentCode).toBe("TOTAL");
		expect(result.matchups.length).toBe(30); // 30 named opponents (D02 has data, 29 others zero filled)
		expect(result.topPlayers.length).toBe(1);
		expect(result.topPlayers[0].username).toBe("TopPlayer1");
	});

	it("throws DeckDetailNotFoundError when deckTypeCode does not exist", async () => {
		await expect(
			useCase.execute({ format: "1109", deckTypeCode: "D99" }, fixedNow),
		).rejects.toThrow(DeckDetailNotFoundError);
		expect(mockRepo.getDeckDetailSnapshot).not.toHaveBeenCalled();
	});

	it("returns hasNamedCatalog=false for 1103 without scanning repository", async () => {
		const result = await useCase.execute({ format: "1103" }, fixedNow);

		expect(mockRepo.getDeckDetailSnapshot).not.toHaveBeenCalled();
		expect(result.hasNamedCatalog).toBe(false);
		expect(result.catalog).toEqual([]);
		expect(result.selected).toBeNull();
	});
});
