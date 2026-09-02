import { NostalgiaRankedJoinStrategy } from "./NostalgiaRankedJoinStrategy";
import { JoinContext } from "./JoinStrategy";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { PlayerInfoMessage } from "@ygopro/messages/client-to-server/PlayerInfoMessage";
import { EventEmitter } from "stream";
import { ISocket } from "@shared/socket/domain/ISocket";
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

	it("does not match lowercase tt or 1103#tt", () => {
		expect(strategy.matches(makeCtx("tt"))).toBe(false);
		expect(strategy.matches(makeCtx("1103#tt"))).toBe(false);
	});

	it("does not match regular numerical room IDs", () => {
		expect(strategy.matches(makeCtx("1103#1001"))).toBe(false);
		expect(strategy.matches(makeCtx("1109#1001"))).toBe(false);
		expect(strategy.matches(makeCtx("1001"))).toBe(false);
	});

	it("does not match extra # segments like 1103#TT#extra", () => {
		expect(strategy.matches(makeCtx("1103#TT#extra"))).toBe(false);
	});

	it("delegates to DirectNostalgiaRankedJoin on handle when ranking is enabled", async () => {
		const ctx = makeCtx("1103#TT");
		await strategy.handle(ctx);
		expect(mockDirectJoin.run).toHaveBeenCalledWith(ctx);
	});

	it("throws error on handle when ranking is disabled", async () => {
		config.ranking.enabled = false;
		const ctx = makeCtx("1103#TT");
		await expect(strategy.handle(ctx)).rejects.toThrow("Ranked rooms are currently disabled");
	});
});
