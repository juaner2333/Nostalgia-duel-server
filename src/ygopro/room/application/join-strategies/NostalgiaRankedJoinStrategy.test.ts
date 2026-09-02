import { NostalgiaRankedJoinStrategy } from "./NostalgiaRankedJoinStrategy";
import { JoinContext } from "./JoinStrategy";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { PlayerInfoMessage } from "@ygopro/messages/client-to-server/PlayerInfoMessage";
import { EventEmitter } from "stream";
import { ISocket } from "@shared/socket/domain/ISocket";
import { DuelState } from "@shared/room/domain/YgoRoom";
import YGOProRoomList from "../../infrastructure/YGOProRoomList";
import { config } from "src/config";

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

const makeCtx = (rawPass: string, playerString = "Player$1234"): JoinContext => {
	const buffer = Buffer.from(playerString, "utf16le");
	const playerInfo = new PlayerInfoMessage(buffer, buffer.length);
	const [command, password = ""] = rawPass.split("#");
	return {
		rawPass,
		command,
		password,
		playerInfo,
		socket: makeMockSocket("socket-1"),
		socketId: "socket-1",
		eventEmitter: new EventEmitter(),
		messageRepository: {} as any,
		logger: new LoggerMock(),
		message: {
			data: Buffer.from([]),
			previousMessage: buffer,
			raw: Buffer.from([]),
			previousRawMessage: buffer,
			size: 0,
			command: 0x12,
		},
	};
};

describe("NostalgiaRankedJoinStrategy", () => {
	let strategy: NostalgiaRankedJoinStrategy;
	let mockDirectJoin: { run: jest.Mock };
	const originalRanking = config.ranking.enabled;

	beforeEach(() => {
		config.ranking.enabled = true;
		mockDirectJoin = { run: jest.fn().mockResolvedValue({ id: 100 }) };
		strategy = new NostalgiaRankedJoinStrategy(mockDirectJoin as any);
	});

	afterEach(() => {
		config.ranking.enabled = originalRanking;
	});

	it("matches exact bare TT", () => {
		expect(strategy.matches(makeCtx("TT"))).toBe(true);
	});

	it("matches exact 1103#TT and 1109#TT", () => {
		expect(strategy.matches(makeCtx("1103#TT"))).toBe(true);
		expect(strategy.matches(makeCtx("1109#TT"))).toBe(true);
	});

	it("matches spectator passes 1103#TT4821 and 1109#TT1001", () => {
		expect(strategy.matches(makeCtx("1103#TT4821"))).toBe(true);
		expect(strategy.matches(makeCtx("1109#TT1001"))).toBe(true);
	});

	it("does not match lowercase tt or 1103#tt or 1103#tt4821", () => {
		expect(strategy.matches(makeCtx("tt"))).toBe(false);
		expect(strategy.matches(makeCtx("1103#tt"))).toBe(false);
		expect(strategy.matches(makeCtx("1103#tt4821"))).toBe(false);
	});

	it("does not match regular numerical room IDs", () => {
		expect(strategy.matches(makeCtx("1103#1001"))).toBe(false);
		expect(strategy.matches(makeCtx("1109#1001"))).toBe(false);
		expect(strategy.matches(makeCtx("1001"))).toBe(false);
	});

	it("does not match extra # segments like 1103#TT#extra or 1103#TT4821#extra", () => {
		expect(strategy.matches(makeCtx("1103#TT#extra"))).toBe(false);
		expect(strategy.matches(makeCtx("1103#TT4821#extra"))).toBe(false);
	});

	it("delegates to DirectNostalgiaRankedJoin on handle when ranking is enabled for TT", async () => {
		const ctx = makeCtx("1103#TT");
		await strategy.handle(ctx);
		expect(mockDirectJoin.run).toHaveBeenCalledWith(ctx);
	});

	it("throws error on handle when ranking is disabled", async () => {
		config.ranking.enabled = false;
		const ctx = makeCtx("1103#TT");
		await expect(strategy.handle(ctx)).rejects.toThrow("Ranked rooms are currently disabled");
	});

	describe("spectator pass handling (format#TT<spectatorId>)", () => {
		it("emits JOIN on the matching dueling ranked room", async () => {
			const mockRoom = {
				id: 4821,
				formatId: "1103",
				isDirectRanked: true,
				duelState: DuelState.DUELING,
				finalizing: false,
				emit: jest.fn(),
			};
			jest.spyOn(YGOProRoomList, "getRooms").mockReturnValue([mockRoom as any]);

			const ctx = makeCtx("1103#TT4821", "Spectator");
			await strategy.handle(ctx);

			expect(mockRoom.emit).toHaveBeenCalledWith("JOIN", ctx.message, ctx.socket);
			expect(mockDirectJoin.run).not.toHaveBeenCalled();
		});

		it("rejects when the matching ranked room is still in WAITING state and does not leak player names", async () => {
			const mockRoom = {
				id: 4821,
				formatId: "1103",
				isDirectRanked: true,
				duelState: DuelState.WAITING,
				finalizing: false,
				players: [{ name: "SecretPlayerName" }],
				emit: jest.fn(),
			};
			jest.spyOn(YGOProRoomList, "getRooms").mockReturnValue([mockRoom as any]);

			const ctx = makeCtx("1103#TT4821", "Spectator");
			await expect(strategy.handle(ctx)).rejects.toThrow(
				"Ranked room is waiting for matchmaking and cannot be spectated",
			);
			expect(mockRoom.emit).not.toHaveBeenCalled();
		});

		it("rejects when no matching ranked room is found", async () => {
			jest.spyOn(YGOProRoomList, "getRooms").mockReturnValue([]);

			const ctx = makeCtx("1103#TT9999", "Spectator");
			await expect(strategy.handle(ctx)).rejects.toThrow("Ranked room not found");
		});

		it("rejects when spectator pass exceeds JoinGame protocol limit of 20 chars", async () => {
			const ctx = makeCtx("1103#TT1234567890123456", "Spectator");
			await expect(strategy.handle(ctx)).rejects.toThrow(
				"Ranked spectator pass exceeds the JoinGame protocol limit",
			);
		});

		it("picks the active dueling room if multiple rooms share the same ID", async () => {
			const waitingRoom = {
				id: 4821,
				formatId: "1103",
				isDirectRanked: true,
				duelState: DuelState.WAITING,
				finalizing: false,
				emit: jest.fn(),
			};
			const duelingRoom = {
				id: 4821,
				formatId: "1103",
				isDirectRanked: true,
				duelState: DuelState.DUELING,
				finalizing: false,
				emit: jest.fn(),
			};
			jest
				.spyOn(YGOProRoomList, "getRooms")
				.mockReturnValue([waitingRoom as any, duelingRoom as any]);

			const ctx = makeCtx("1103#TT4821", "Spectator");
			await strategy.handle(ctx);

			expect(duelingRoom.emit).toHaveBeenCalledWith("JOIN", ctx.message, ctx.socket);
			expect(waitingRoom.emit).not.toHaveBeenCalled();
		});
	});
});
