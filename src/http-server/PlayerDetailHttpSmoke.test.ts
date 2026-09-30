import { Request, Response } from "express";
import { config } from "src/config";
import { PlayerDetailPageController } from "./controllers/PlayerDetailPageController";
import { GetPlayerDetailController } from "./controllers/GetPlayerDetailController";
import { PlayerDetailPostgresRepository } from "src/shared/stats/player-detail/infrastructure/postgres/PlayerDetailPostgresRepository";
import { UserProfilePostgresRepository } from "src/shared/user-profile/infrastructure/postgres/UserProfilePostgresRepository";
import { UserProfile } from "src/shared/user-profile/domain/UserProfile";

jest.mock("../evolution-types/src/data-source", () => ({
	dataSource: {
		query: jest.fn(),
		getRepository: jest.fn(),
	},
}));

function fakeResponse(): {
	res: Response;
	text: () => string;
	status: () => number;
	json: () => any;
	header: (name: string) => string | undefined;
} {
	let statusCode = 200;
	let textPayload = "";
	let jsonPayload: any = null;
	const headers: Record<string, string> = {};

	const res = {
		status(code: number) {
			statusCode = code;
			return this;
		},
		send(data: any) {
			textPayload = String(data);
			return this;
		},
		json(data: any) {
			jsonPayload = data;
			return this;
		},
		type(_type: string) {
			return this;
		},
		setHeader(name: string, value: string) {
			headers[name.toLowerCase()] = value;
			return this;
		},
	} as unknown as Response;

	return {
		res,
		text: () => textPayload,
		status: () => statusCode,
		json: () => jsonPayload,
		header: (name: string) => headers[name.toLowerCase()],
	};
}

describe("PlayerDetail Dual-Format HTTP Smoke Test (Task 6.3)", () => {
	let pageController: PlayerDetailPageController;
	let apiController: GetPlayerDetailController;

	const dummyUser = {
		id: "uid-001",
		username: "测试玩家",
		password: "hash",
		isValidPassword: jest.fn(),
	} as unknown as UserProfile;

	beforeAll(() => {
		config.ranking.enabled = true;
		pageController = new PlayerDetailPageController();
		apiController = new GetPlayerDetailController();
	});

	beforeEach(() => {
		jest.clearAllMocks();
		jest
			.spyOn(UserProfilePostgresRepository.prototype, "findByUsername")
			.mockResolvedValue(dummyUser);
	});

	it("serves HTML page for 1103 with 200, correct brand, and no-store headers", () => {
		const req = { params: { format: "1103" } } as unknown as Request;
		const fake = fakeResponse();

		pageController.run(req, fake.res);

		expect(fake.status()).toBe(200);
		expect(fake.header("cache-control")).toContain("no-store");
		expect(fake.text()).toContain("Nostalgia Duel Server · 1103 玩家战绩");
		expect(fake.text()).toContain("总战绩");
		expect(fake.text()).toContain("总使用率");
		expect(fake.text()).toContain("积分变化");
		expect(fake.text()).toContain("最近战绩");
	});

	it("serves HTML page for 1109 with 200 and format isolation", () => {
		const req = { params: { format: "1109" } } as unknown as Request;
		const fake = fakeResponse();

		pageController.run(req, fake.res);

		expect(fake.status()).toBe(200);
		expect(fake.text()).toContain("Nostalgia Duel Server · 1109 玩家战绩");
	});

	it("returns 404 for unknown format on both page and API", async () => {
		const pageReq = { params: { format: "9999" } } as unknown as Request;
		const pageFake = fakeResponse();
		pageController.run(pageReq, pageFake.res);
		expect(pageFake.status()).toBe(404);

		const apiReq = {
			params: { format: "9999" },
			body: { player: "测试玩家" },
			socket: {},
		} as unknown as Request;
		const apiFake = fakeResponse();
		await apiController.run(apiReq, apiFake.res);
		expect(apiFake.status()).toBe(404);
		expect(apiFake.json().success).toBe(false);
	});

	it("executes public mode query: returns 200 with data, overall/season summaries, and matches", async () => {
		jest
			.spyOn(PlayerDetailPostgresRepository.prototype, "getPlayerOverallSummary")
			.mockResolvedValue({
				rank: 1,
				points: 200,
				matches: 20,
				wins: 15,
				losses: 5,
				winRate: 0.75,
			});
		jest
			.spyOn(PlayerDetailPostgresRepository.prototype, "getPlayerSeasonSummary")
			.mockResolvedValue({
				rank: 1,
				points: 120,
				matches: 12,
				wins: 9,
				losses: 3,
				winRate: 0.75,
			});
		jest.spyOn(PlayerDetailPostgresRepository.prototype, "getPlayerDeckStats").mockResolvedValue([
			{
				deckTypeCode: "HERO",
				deckTypeName: "元素英雄",
				matches: 12,
				wins: 9,
				losses: 3,
				winRate: 0.75,
				firstCount: 6,
				secondCount: 5,
				firstRate: 0.5455,
			},
		]);
		jest
			.spyOn(PlayerDetailPostgresRepository.prototype, "getRatingTrendMatches")
			.mockResolvedValue([{ matchId: "m-1", date: new Date("2026-03-01"), pointsChange: 5 }]);
		jest
			.spyOn(PlayerDetailPostgresRepository.prototype, "getMatchHistoryCount")
			.mockResolvedValue(40);
		jest.spyOn(PlayerDetailPostgresRepository.prototype, "getMatchHistoryPage").mockResolvedValue([
			{
				matchId: "m-1",
				gameId: "g-1",
				date: new Date("2026-03-01"),
				winner: true,
				playerScore: 2,
				opponentScore: 1,
				playerPointsChange: 5,
				season: 202603,
				playerSettledPoints: 200,
				opponentUserId: "uid-002",
				opponentMatchId: "m-opp-1",
				opponentUsername: "对手玩家",
				opponentPlayerScore: 1,
				opponentPointsChange: -5,
				opponentSettledPoints: 80,
				opponentCanJump: true,
			},
		]);
		jest.spyOn(PlayerDetailPostgresRepository.prototype, "getMatchDecksBatch").mockResolvedValue([
			{
				matchId: "m-1",
				isOpponent: false,
				deckTypeCode: "HERO",
				deckTypeName: "元素英雄",
				hasSnapshot: true,
				isPartial: false,
			},
			{
				matchId: "m-opp-1",
				isOpponent: true,
				deckTypeCode: "OTHERS",
				deckTypeName: "其他",
				hasSnapshot: true,
				isPartial: true,
			},
		]);
		jest
			.spyOn(PlayerDetailPostgresRepository.prototype, "getMatchDuelsBatch")
			.mockResolvedValue([{ matchId: "m-1", duelIndex: 1, replayId: "rep-1", isFirst: true }]);

		const apiReq = {
			params: { format: "1103" },
			body: { player: "测试玩家", scope: "season", season: "2026H1" },
			socket: {},
		} as unknown as Request;
		const apiFake = fakeResponse();

		await apiController.run(apiReq, apiFake.res);

		expect(apiFake.status()).toBe(200);
		expect(apiFake.json().success).toBe(true);
		expect(apiFake.json().data.found).toBe(true);
		expect(apiFake.json().data.isVerified).toBe(false);
		expect(apiFake.json().data.matches[0].playerDeck.downloadUrl).toBe(
			"/api/ladder/1103/matches/m-1/deck",
		);
		expect(apiFake.json().data.matches[0].opponentDeck.downloadUrl).toBe(
			"/api/ladder/1103/matches/m-opp-1/deck",
		);
		expect(apiFake.json().data.matches[0].opponentDeck.isPartial).toBe(true);
		expect(apiFake.json().data.matches[0].duels[0].downloadUrl).toBe("/api/replays/1103/rep-1");
	});

	it("executes verified mode query with pagination when password is valid", async () => {
		(dummyUser.isValidPassword as jest.Mock).mockResolvedValueOnce(true);

		const apiReq = {
			params: { format: "1103" },
			body: { player: "测试玩家", password: "valid-pin", page: 2 },
			socket: {},
		} as unknown as Request;
		const apiFake = fakeResponse();

		await apiController.run(apiReq, apiFake.res);

		expect(apiFake.status()).toBe(200);
		expect(apiFake.json().success).toBe(true);
		expect(apiFake.json().data.isVerified).toBe(true);
		expect(apiFake.json().data.pagination.page).toBe(2);
		expect(apiFake.json().data.pagination.total).toBe(40);
	});
});
