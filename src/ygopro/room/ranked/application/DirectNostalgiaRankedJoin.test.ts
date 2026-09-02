import { EventEmitter } from "stream";
import { UserProfile } from "@shared/user-profile/domain/UserProfile";

const mockFindById = jest.fn();
const mockIsBanned = jest.fn().mockResolvedValue(false);
const mockFindByUsername = jest.fn();
const mockCreate = jest.fn().mockResolvedValue(undefined);

jest.mock("@shared/user-profile/infrastructure/postgres/UserProfilePostgresRepository", () => ({
	UserProfilePostgresRepository: jest.fn().mockImplementation(() => ({
		findById: mockFindById,
		isBanned: mockIsBanned,
		findByUsername: mockFindByUsername,
		create: mockCreate,
	})),
}));

import { DirectNostalgiaRankedJoin } from "./DirectNostalgiaRankedJoin";
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

		userProfileRepository = {
			create: mockCreate,
			findByUsername: mockFindByUsername,
			findById: mockFindById,
			isBanned: mockIsBanned,
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
});
