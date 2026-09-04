import { EventEmitter } from "stream";
import { UserProfile } from "@shared/user-profile/domain/UserProfile";

const mockFindById = jest.fn();
const mockIsBanned = jest.fn().mockResolvedValue(false);
const mockFindByUsername = jest.fn();
const mockCreate = jest.fn().mockResolvedValue(undefined);
const mockUpdatePassword = jest.fn().mockResolvedValue(undefined);

jest.mock("@shared/user-profile/infrastructure/postgres/UserProfilePostgresRepository", () => ({
	UserProfilePostgresRepository: jest.fn().mockImplementation(() => ({
		findById: mockFindById,
		isBanned: mockIsBanned,
		findByUsername: mockFindByUsername,
		create: mockCreate,
		updatePassword: mockUpdatePassword,
	})),
}));

import { DirectNostalgiaRankedJoin, RANKED_FORMAT_CLIENT_ERROR } from "./DirectNostalgiaRankedJoin";
import { JoinRejectionError } from "../../domain/errors/JoinRejectionError";
import { AuthenticateOrRegisterPinUser } from "@shared/user-auth/application/AuthenticateOrRegisterPinUser";
import { RankedRoomRegistry } from "../domain/RankedRoomRegistry";
import { UserProfileRepository } from "@shared/user-profile/domain/UserProfileRepository";
import { NostalgiaFormatResourcePort } from "../../domain/NostalgiaFormatResourcePort";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { PlayerInfoMessage } from "@ygopro/messages/client-to-server/PlayerInfoMessage";
import YGOProRoomList from "../../infrastructure/YGOProRoomList";
import { DuelState } from "@shared/room/domain/YgoRoom";
import { RoomLeague } from "@shared/room/admission/domain/RoomLeague";
import { ISocket } from "@shared/socket/domain/ISocket";

const makeMockSocket = (id: string): ISocket => ({
	id,
	transport: "tcp",
	send: jest.fn(),
	onMessage: jest.fn(),
	onClose: jest.fn(),
	close: jest.fn(),
	destroy: jest.fn(),
	remoteAddress: "127.0.0.1",
	closed: false,
	removeAllListeners: jest.fn(),
});

describe("DirectNostalgiaRankedJoin", () => {
	let userProfileRepository: jest.Mocked<UserProfileRepository>;
	let authUseCase: AuthenticateOrRegisterPinUser;
	let registry: RankedRoomRegistry;
	let mockResources: NostalgiaFormatResourcePort;
	let useCase: DirectNostalgiaRankedJoin;
	let logger: LoggerMock;

	beforeEach(() => {
		// Clear room list
		const rooms = [...YGOProRoomList.getRooms()];
		rooms.forEach((r) => YGOProRoomList.deleteRoom(r));

		registry = new RankedRoomRegistry();
		registry.clear();

		mockFindById.mockReset();
		mockIsBanned.mockReset().mockResolvedValue(false);
		mockFindByUsername.mockReset();
		mockCreate.mockReset().mockResolvedValue(undefined);
		mockUpdatePassword.mockReset().mockResolvedValue(undefined);

		userProfileRepository = {
			create: mockCreate,
			findByUsername: mockFindByUsername,
			findById: mockFindById,
			isBanned: mockIsBanned,
			updatePassword: mockUpdatePassword,
		};
		authUseCase = new AuthenticateOrRegisterPinUser(userProfileRepository);

		mockResources = {
			getBanListHash: jest.fn().mockReturnValue(12345),
		};

		logger = new LoggerMock();
		useCase = new DirectNostalgiaRankedJoin(authUseCase, registry, mockResources);
	});

	const makeRequest = (rawPass: string, playerName: string, pin: string) => {
		const socketId = "socket-" + Math.random().toString(36).substring(7);
		const socket = makeMockSocket(socketId);
		const rawString = `${playerName}$${pin}`;
		const buffer = Buffer.from(rawString, "utf16le");
		const playerInfo = new PlayerInfoMessage(buffer, buffer.length);
		const message = {
			data: Buffer.from([]),
			previousMessage: buffer,
			raw: Buffer.from([]),
			previousRawMessage: buffer,
			size: 0,
			command: 0x12,
		};
		const eventEmitter = new EventEmitter();

		return {
			rawPass,
			command: rawPass,
			password: "",
			playerInfo,
			socket,
			socketId: socket.id as string,
			eventEmitter,
			messageRepository: {
				errorMessage: jest.fn(),
				watchChangeMessage: jest.fn(),
				playerChangeMessage: jest.fn(),
			} as any,
			logger,
			message,
		};
	};

	it("creates a new direct ranked waiting room for first 1103 player", async () => {
		userProfileRepository.findByUsername.mockResolvedValueOnce(null);

		const req = makeRequest("1103#TT", "Player1", "1234");
		const room = await useCase.run(req);

		expect(room).toBeDefined();
		expect(room.formatId).toBe("1103");
		expect(room.isDirectRanked).toBe(true);
		expect(room.league).toBe(RoomLeague.External);
		expect(room.duelState).toBe(DuelState.WAITING);
		expect(YGOProRoomList.getRooms()).toHaveLength(1);
		expect(registry.getReservations(room.id)).toBe(1);
	});

	it("matches second 1103 player into existing waiting room without creating a new room", async () => {
		userProfileRepository.findByUsername.mockResolvedValue(null);

		const req1 = makeRequest("1103#TT", "Player1", "1234");
		const room1 = await useCase.run(req1);

		const req2 = makeRequest("1103#TT", "Player2", "5678");
		const room2 = await useCase.run(req2);

		expect(room2.id).toBe(room1.id);
		expect(YGOProRoomList.getRooms()).toHaveLength(1);
		expect(registry.getReservations(room1.id)).toBe(2);
	});

	it("creates a second 1103 room when the first room has 2 seats occupied or reserved", async () => {
		userProfileRepository.findByUsername.mockResolvedValue(null);

		const req1 = makeRequest("1103#TT", "Player1", "1234");
		const room1 = await useCase.run(req1);

		const req2 = makeRequest("1103#TT", "Player2", "5678");
		const room2 = await useCase.run(req2);

		const req3 = makeRequest("1103#TT", "Player3", "9999");
		const room3 = await useCase.run(req3);

		expect(room3.id).not.toBe(room1.id);
		expect(YGOProRoomList.getRooms()).toHaveLength(2);
	});

	it("allows a subsequent player to join the waiting room when one of the two players leaves", async () => {
		userProfileRepository.findByUsername.mockResolvedValue(null);

		const req1 = makeRequest("1103#TT", "Player1", "1234");
		const room1 = await useCase.run(req1);

		const req2 = makeRequest("1103#TT", "Player2", "5678");
		const room2 = await useCase.run(req2);
		expect(room2.id).toBe(room1.id);
		expect(registry.getReservations(room1.id)).toBe(2);

		// Player 2 leaves while in WAITING state
		registry.releaseReservation(room1.id);
		expect(registry.getReservations(room1.id)).toBe(1);

		// Player 3 joins 1103#TT and should enter room1 instead of creating room2
		const req3 = makeRequest("1103#TT", "Player3", "9999");
		const room3 = await useCase.run(req3);

		expect(room3.id).toBe(room1.id);
		expect(YGOProRoomList.getRooms()).toHaveLength(1);
		expect(registry.getReservations(room1.id)).toBe(2);
	});

	it("isolates 1103 and 1109 formats so 1109 join does not enter 1103 waiting room", async () => {
		userProfileRepository.findByUsername.mockResolvedValue(null);

		const req1 = makeRequest("1103#TT", "Player1", "1234");
		const room1 = await useCase.run(req1);

		const req2 = makeRequest("1109#TT", "Player2", "5678");
		const room2 = await useCase.run(req2);

		expect(room1.formatId).toBe("1103");
		expect(room2.formatId).toBe("1109");
		expect(room2.id).not.toBe(room1.id);
		expect(YGOProRoomList.getRooms()).toHaveLength(2);
	});

	it("normalizes bare TT input to 1109 direct ranked", async () => {
		userProfileRepository.findByUsername.mockResolvedValue(null);

		const req = makeRequest("TT", "Player1", "1234");
		const room = await useCase.run(req);

		expect(room.formatId).toBe("1109");
		expect(room.isDirectRanked).toBe(true);
	});

	it("recovers original 1103 room for an account that already occupies 1103 even when joining with bare TT", async () => {
		const user = await UserProfile.create({
			id: "user-100",
			username: "OccupiedUser",
			password: "1111",
			email: null,
			avatar: null,
		});
		userProfileRepository.findByUsername.mockResolvedValue(user);

		// First join creates 1103 room and records occupancy
		const req1 = makeRequest("1103#TT", "OccupiedUser", "1111");
		const room1 = await useCase.run(req1);
		registry.recordOccupancy("user-100", room1.id, "1103");

		// Second join uses bare TT (which defaults to 1109 for new joins)
		const req2 = makeRequest("TT", "OccupiedUser", "1111");
		const room2 = await useCase.run(req2);

		expect(room2.id).toBe(room1.id);
		expect(room2.formatId).toBe("1103");
	});

	it("sends private ranked in-game notice chat message to player on join", async () => {
		const user = await UserProfile.create({
			id: "user-notice",
			username: "NoticeUser",
			password: "1234",
			email: null,
			avatar: null,
		});
		userProfileRepository.findByUsername.mockResolvedValue(user);

		const mockLeaderboardRepo = {
			getSeasonLeaderboard: jest.fn(),
			getOverallLeaderboard: jest.fn(),
			getPlayerMonthlyStats: jest.fn().mockResolvedValue({
				format: "1109",
				season: "2026-09",
				points: 10,
				wins: 5,
				losses: 1,
				winRate: 0.8333,
				rank: 1,
			}),
		};

		const testUseCase = new DirectNostalgiaRankedJoin(
			authUseCase,
			registry,
			mockResources,
			mockLeaderboardRepo,
		);

		const req = makeRequest("TT", "NoticeUser", "1234");
		await testUseCase.run(req);

		// Allow microtasks to complete
		await new Promise((resolve) => setImmediate(resolve));

		expect(mockLeaderboardRepo.getPlayerMonthlyStats).toHaveBeenCalledWith(
			"user-notice",
			"1109",
			expect.any(Number),
		);
		expect(req.socket.send).toHaveBeenCalled();
	});

	describe("ranked format and authentication rejection handling", () => {
		const FORMAT_ERROR_PROMPT =
			"排位登录格式错误：请将玩家名填写为“昵称$4位数字PIN”，完整内容不能超过20个字符（例如：玩家$1234）。";

		const makeRawRequest = (rawPass: string, rawPlayerString: string) => {
			const socketId = "socket-" + Math.random().toString(36).substring(7);
			const socket = makeMockSocket(socketId);
			const buffer = Buffer.from(rawPlayerString, "utf16le");
			const playerInfo = new PlayerInfoMessage(buffer, buffer.length);
			const message = {
				data: Buffer.from([]),
				previousMessage: buffer,
				raw: Buffer.from([]),
				previousRawMessage: buffer,
				size: 0,
				command: 0x12,
			};
			const eventEmitter = new EventEmitter();

			return {
				rawPass,
				command: rawPass,
				password: "",
				playerInfo,
				socket,
				socketId: socket.id as string,
				eventEmitter,
				messageRepository: {
					errorMessage: jest.fn(),
					watchChangeMessage: jest.fn(),
					playerChangeMessage: jest.fn(),
				} as any,
				logger,
				message,
			};
		};

		it("rejects player with missing $ delimiter with format error prompt", async () => {
			const req = makeRawRequest("1109#TT", "PlayerNoDollar");
			await expect(useCase.run(req)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: FORMAT_ERROR_PROMPT,
			});
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
		});

		it("rejects player with empty nickname with format error prompt", async () => {
			const req = makeRawRequest("1109#TT", "$1234");
			await expect(useCase.run(req)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: FORMAT_ERROR_PROMPT,
			});
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
		});

		it("rejects player with 3-digit PIN with format error prompt", async () => {
			const req = makeRawRequest("1109#TT", "Player$123");
			await expect(useCase.run(req)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: FORMAT_ERROR_PROMPT,
			});
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
		});

		it("rejects player with 5-digit PIN with format error prompt", async () => {
			const req = makeRawRequest("1109#TT", "Player$12345");
			await expect(useCase.run(req)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: FORMAT_ERROR_PROMPT,
			});
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
		});

		it("rejects player with non-digit PIN with format error prompt", async () => {
			const req = makeRawRequest("1109#TT", "Player$abcd");
			await expect(useCase.run(req)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: FORMAT_ERROR_PROMPT,
			});
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
		});

		it("rejects player with multiple $ delimiters with format error prompt", async () => {
			const req = makeRawRequest("1109#TT", "Due$list$1234");
			await expect(useCase.run(req)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: FORMAT_ERROR_PROMPT,
			});
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
		});

		it("rejects player where nickname too long causes PIN truncation at 20 chars", async () => {
			// 16 chars name + $ + 3 chars PIN = 20 chars
			const req = makeRawRequest("1109#TT", "1234567890123456$123");
			await expect(useCase.run(req)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: FORMAT_ERROR_PROMPT,
			});
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
		});

		it("rejects player when nickname contains a colon (Alice:shadow$1234) before auth, room, seat, and occupancy", async () => {
			const reserveSpy = jest.spyOn(registry, "reserveSeat");
			const recordOccupancySpy = jest.spyOn(registry, "recordOccupancy");

			const req = makeRawRequest("1109#TT", "Alice:shadow$1234");
			await expect(useCase.run(req)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: RANKED_FORMAT_CLIENT_ERROR,
			});
			expect(userProfileRepository.findByUsername).not.toHaveBeenCalled();
			expect(userProfileRepository.create).not.toHaveBeenCalled();
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
			expect(reserveSpy).not.toHaveBeenCalled();
			expect(recordOccupancySpy).not.toHaveBeenCalled();
		});

		it("accepts valid ranked player without colon (Alice$1234)", async () => {
			userProfileRepository.findByUsername.mockResolvedValueOnce(null);
			const req = makeRawRequest("1109#TT", "Alice$1234");
			const room = await useCase.run(req);
			expect(room).toBeDefined();
			expect(userProfileRepository.findByUsername).toHaveBeenCalledWith("Alice");
			expect(YGOProRoomList.getRooms()).toHaveLength(1);
		});

		it("accepts player exactly filling the 20 UTF-16 character limit (15 chars + $ + 4 digits)", async () => {
			userProfileRepository.findByUsername.mockResolvedValueOnce(null);
			const exact20 = "123456789012345$1234";
			expect(exact20.length).toBe(20);
			const req = makeRawRequest("1109#TT", exact20);
			const room = await useCase.run(req);
			expect(room).toBeDefined();
			expect(YGOProRoomList.getRooms()).toHaveLength(1);
		});

		it("rejects player when PIN does not match existing account", async () => {
			const existingUser = await UserProfile.create({
				id: "user-pin-mismatch",
				username: "ExistingPlayer",
				password: "9999",
				email: null,
				avatar: null,
			});
			userProfileRepository.findByUsername.mockResolvedValueOnce(existingUser);

			const req = makeRequest("1109#TT", "ExistingPlayer", "1234");
			await expect(useCase.run(req)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: "排位密码错误：请输入该昵称对应的4位数字PIN。",
			});
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
		});

		it("rejects player when account is banned", async () => {
			const bannedUser = await UserProfile.create({
				id: "user-banned",
				username: "BannedPlayer",
				password: "1234",
				email: null,
				avatar: null,
			});
			userProfileRepository.findByUsername.mockResolvedValueOnce(bannedUser);
			mockIsBanned.mockResolvedValueOnce(true);

			const req = makeRequest("1109#TT", "BannedPlayer", "1234");
			await expect(useCase.run(req)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: "该排位账号已被封禁，如有疑问请联系管理员。",
			});
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
		});

		it("rejects player when user registration race or auth fails", async () => {
			userProfileRepository.findByUsername.mockResolvedValue(null);
			mockCreate.mockRejectedValueOnce(new Error("DB collision"));

			const req = makeRequest("1109#TT", "RacePlayer", "1234");
			await expect(useCase.run(req)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: "排位账号认证失败，请稍后重试。",
			});
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
		});

		it("rejects player already occupied in another format", async () => {
			const user = await UserProfile.create({
				id: "user-occupied-other",
				username: "OccupiedOther",
				password: "1234",
				email: null,
				avatar: null,
			});
			userProfileRepository.findByUsername.mockResolvedValue(user);

			// First join 1103
			const req1 = makeRequest("1103#TT", "OccupiedOther", "1234");
			const room1 = await useCase.run(req1);
			registry.recordOccupancy("user-occupied-other", room1.id, "1103");

			// Try to join 1109
			const req2 = makeRequest("1109#TT", "OccupiedOther", "1234");
			await expect(useCase.run(req2)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: "你已加入 1103 排位，无法同时加入 1109 排位。",
			});
		});

		it("rejects join when nostalgia ban list is unavailable", async () => {
			userProfileRepository.findByUsername.mockResolvedValueOnce(null);
			const noBanlistResources: NostalgiaFormatResourcePort = {
				getBanListHash: jest.fn().mockReturnValue(null),
			};
			const badResourcesUseCase = new DirectNostalgiaRankedJoin(
				authUseCase,
				registry,
				noBanlistResources,
			);
			const req = makeRequest("1109#TT", "NoBanlistPlayer", "1234");
			await expect(badResourcesUseCase.run(req)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: "排位房间暂时不可用，请稍后重试。",
			});
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
		});

		it("rejects player with JoinRejectionError when authentication throws a database error", async () => {
			userProfileRepository.findByUsername.mockRejectedValueOnce(
				new Error("Database connection lost"),
			);

			const req = makeRequest("1109#TT", "DbErrorPlayer", "1234");
			await expect(useCase.run(req)).rejects.toMatchObject({
				name: "JoinRejectionError",
				clientMessage: "排位账号认证失败，请稍后重试。",
				message: expect.stringContaining("Database connection lost"),
			});
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
		});
	});
});
