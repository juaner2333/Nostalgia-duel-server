import { GetPlayerDetail, PlayerDetailRateLimitExceededError } from "./GetPlayerDetail";
import { PlayerDetailRepository } from "../domain/PlayerDetailRepository";
import { UserProfileRepository } from "src/shared/user-profile/domain/UserProfileRepository";
import { PlayerDetailAuthRateLimiter } from "../domain/PlayerDetailAuthRateLimiter";
import { Logger } from "src/shared/logger/domain/Logger";
import { UserProfile } from "src/shared/user-profile/domain/UserProfile";

describe("GetPlayerDetail (Application Use Case)", () => {
	let repository: jest.Mocked<PlayerDetailRepository>;
	let userProfileRepository: jest.Mocked<UserProfileRepository>;
	let authRateLimiter: jest.Mocked<PlayerDetailAuthRateLimiter>;
	let logger: jest.Mocked<Logger>;
	let useCase: GetPlayerDetail;

	const dummyUser = {
		id: "user-123",
		username: "武藤游戏",
		password: "hashed-password",
		isValidPassword: jest.fn(),
	} as unknown as UserProfile;

	beforeEach(() => {
		jest.clearAllMocks();
		repository = {
			getPlayerOverallSummary: jest.fn().mockResolvedValue({
				rank: 1,
				points: 100,
				matches: 10,
				wins: 8,
				losses: 2,
				winRate: 0.8,
			}),
			getPlayerSeasonSummary: jest.fn().mockResolvedValue({
				rank: 1,
				points: 60,
				matches: 6,
				wins: 5,
				losses: 1,
				winRate: 0.8333,
			}),
			getPlayerDeckStats: jest.fn().mockResolvedValue([
				{
					deckTypeCode: "HERO",
					deckTypeName: "元素英雄",
					matches: 6,
					wins: 5,
					losses: 1,
					winRate: 0.8333,
					firstCount: 3,
					secondCount: 2,
					firstRate: 0.6,
				},
			]),
			getRatingTrendMatches: jest
				.fn()
				.mockResolvedValue([{ matchId: "m1", date: new Date("2026-03-01"), pointsChange: 5 }]),
			getMatchHistoryCount: jest.fn().mockResolvedValue(50),
			getMatchHistoryPage: jest.fn().mockResolvedValue([
				{
					matchId: "m1",
					gameId: "g1",
					date: new Date("2026-03-01"),
					winner: true,
					playerScore: 2,
					opponentScore: 0,
					playerPointsChange: 5,
					season: 202603,
					playerSettledPoints: 100,
					opponentUserId: "user-456",
					opponentUsername: "海马濑人",
					opponentPlayerScore: 0,
					opponentPointsChange: -5,
					opponentSettledPoints: 90,
					opponentCanJump: true,
				},
			]),
			getMatchDecksBatch: jest.fn().mockResolvedValue([
				{
					matchId: "m1",
					isOpponent: false,
					deckTypeCode: "HERO",
					deckTypeName: "元素英雄",
					hasSnapshot: true,
					isPartial: false,
				},
			]),
			getMatchDuelsBatch: jest.fn().mockResolvedValue([
				{
					matchId: "m1",
					duelIndex: 1,
					replayId: "rep-1",
					isFirst: true,
				},
			]),
		};

		userProfileRepository = {
			findByUsername: jest.fn().mockResolvedValue(dummyUser),
			findById: jest.fn(),
			create: jest.fn(),
			isBanned: jest.fn(),
			updatePassword: jest.fn(),
		};

		authRateLimiter = {
			isLimited: jest.fn().mockResolvedValue(false),
			recordFailure: jest.fn().mockResolvedValue(undefined),
			reset: jest.fn().mockResolvedValue(undefined),
		};

		logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
			child: jest.fn().mockReturnThis(),
		};

		useCase = new GetPlayerDetail(repository, userProfileRepository, authRateLimiter, logger);
	});

	it("returns found=false when target player account does not exist", async () => {
		userProfileRepository.findByUsername.mockResolvedValueOnce(null);

		const result = await useCase.execute({
			player: "不存在的玩家",
			format: "1103",
		});

		expect(result.found).toBe(false);
		expect(result.player).toBe("不存在的玩家");
		expect(result.isVerified).toBe(false);
		expect(result.overallSummary).toBeNull();
		expect(result.matches).toHaveLength(0);
		expect(result.pagination.total).toBe(0);
	});

	it("queries public mode when no password is provided (limits to 20 matches and page 1)", async () => {
		const result = await useCase.execute({
			player: "武藤游戏",
			format: "1103",
			page: 2, // Requesting page 2 without password must be forced to page 1
		});

		expect(result.found).toBe(true);
		expect(result.isVerified).toBe(false);
		expect(result.authFailed).toBe(false);
		expect(result.pagination.page).toBe(1);
		expect(result.pagination.pageSize).toBe(20);
		expect(result.pagination.total).toBe(1); // Only visible matches count (max 20)

		// Verified that repository was called with offset 0 and limit 20
		expect(repository.getMatchHistoryPage).toHaveBeenCalledWith("user-123", "1103", 0, 20);
		expect(dummyUser.isValidPassword).not.toHaveBeenCalled();
	});

	it("falls back to public mode and records failure when incorrect password is provided", async () => {
		(dummyUser.isValidPassword as jest.Mock).mockResolvedValueOnce(false);

		const result = await useCase.execute(
			{
				player: "武藤游戏",
				format: "1103",
				password: "wrong-password",
				page: 2,
			},
			"127.0.0.1",
		);

		expect(result.found).toBe(true);
		expect(result.isVerified).toBe(false);
		expect(result.authFailed).toBe(true);
		expect(result.pagination.page).toBe(1); // Fallback to page 1
		expect(authRateLimiter.recordFailure).toHaveBeenCalledWith("127.0.0.1", "武藤游戏");
		expect(authRateLimiter.reset).not.toHaveBeenCalled();
		expect(repository.getMatchHistoryPage).toHaveBeenCalledWith("user-123", "1103", 0, 20);
	});

	it("unlocks full history pagination when correct password is provided", async () => {
		(dummyUser.isValidPassword as jest.Mock).mockResolvedValueOnce(true);

		const result = await useCase.execute(
			{
				player: "武藤游戏",
				format: "1103",
				password: "correct-password",
				page: 2,
			},
			"127.0.0.1",
		);

		expect(result.found).toBe(true);
		expect(result.isVerified).toBe(true);
		expect(result.authFailed).toBe(false);
		expect(result.pagination.page).toBe(2);
		expect(result.pagination.pageSize).toBe(20);
		expect(result.pagination.total).toBe(50); // Full total count from repository

		expect(authRateLimiter.reset).toHaveBeenCalledWith("127.0.0.1", "武藤游戏");
		expect(repository.getMatchHistoryPage).toHaveBeenCalledWith("user-123", "1103", 20, 20);
	});

	it("throws PlayerDetailRateLimitExceededError when auth attempts exceeded limit", async () => {
		authRateLimiter.isLimited.mockResolvedValueOnce(true);

		await expect(
			useCase.execute(
				{
					player: "武藤游戏",
					format: "1103",
					password: "any-password",
				},
				"127.0.0.1",
			),
		).rejects.toThrow(PlayerDetailRateLimitExceededError);

		expect(dummyUser.isValidPassword).not.toHaveBeenCalled();
	});

	it("allows public query even if auth limiter would block password verification", async () => {
		authRateLimiter.isLimited.mockResolvedValueOnce(true);

		// Public query with NO password must not check auth rate limit
		const result = await useCase.execute({
			player: "武藤游戏",
			format: "1103",
		});

		expect(result.found).toBe(true);
		expect(result.isVerified).toBe(false);
		expect(authRateLimiter.isLimited).not.toHaveBeenCalled();
	});

	it("does not leak passwords, hashes, email, or internal userId in the result DTO", async () => {
		(dummyUser.isValidPassword as jest.Mock).mockResolvedValueOnce(true);

		const result = await useCase.execute({
			player: "武藤游戏",
			format: "1103",
			password: "correct-password",
		});

		const json = JSON.stringify(result);
		expect(json).not.toContain("hashed-password");
		expect(json).not.toContain("correct-password");
		expect(json).not.toContain("user-123"); // Target player internal userId must not leak
		expect(json).not.toContain("email");
	});
});
