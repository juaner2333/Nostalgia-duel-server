/**
 * Integration tests for YGOProJoinHandler with strategy chain.
 *
 * Verifies that:
 * 1. Normal (non-AI) joins still work (regression guard for DefaultJoinStrategy extraction)
 * 2. Strategy chain iterates in order until one handles
 * 3. The registry can be injected for testing via createForTests
 */

import { EventEmitter } from "stream";

import { YGOProJoinHandler } from "../YGOProJoinHandler";
import { JoinStrategyRegistry } from "./JoinStrategyRegistry";
import { JoinContext, JoinStrategy } from "./JoinStrategy";
import { DefaultJoinStrategy } from "./DefaultJoinStrategy";
import { NostalgiaJoinStrategy } from "./NostalgiaJoinStrategy";
import { YGOProStocChat } from "ygopro-msg-encode";

import YGOProRoomList from "../../infrastructure/YGOProRoomList";
import { YGOProRoom } from "../../domain/YGOProRoom";
import { JoinRejectionError } from "../../domain/errors/JoinRejectionError";

// Suppress unhandled WaitingState errors in tests that don't set up full room infrastructure
let waitingSpy: jest.SpyInstance;
let roomEmitSpy: jest.SpyInstance;

// ---- helpers ----

const makeLogger = () => ({
	child: jest.fn().mockReturnThis(),
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn(),
});

const makeSocket = (id = "sock-handler") => ({
	id,
	destroy: jest.fn(),
	send: jest.fn(),
	close: jest.fn(),
	roomId: undefined as number | undefined,
});

const makeMessageRepository = () => ({
	errorMessage: jest.fn().mockReturnValue(Buffer.alloc(0)),
	joinGameMessage: jest.fn().mockReturnValue(Buffer.alloc(0)),
	typeChangeMessage: jest.fn().mockReturnValue(Buffer.alloc(0)),
	playerEnterMessage: jest.fn().mockReturnValue(Buffer.alloc(0)),
	playerChangeMessage: jest.fn().mockReturnValue(Buffer.alloc(0)),
	spectatorCountMessage: jest.fn().mockReturnValue(Buffer.alloc(0)),
});

/**
 * Build a minimal JOIN_GAME ClientMessage payload.
 *
 * YGOProCtosJoinGame field layout (from BinaryField decorators):
 *   - version:  u16 at offset 0  (2 bytes)
 *   - (padding) 2 bytes at offset 2
 *   - gameid:   u32 at offset 4  (4 bytes)
 *   - pass:     utf16 at offset 8, max 20 chars = 40 bytes
 *
 * Total data size: 48 bytes minimum.
 */
const makeJoinMessage = (pass: string): { data: Buffer; previousMessage: Buffer } =>
	makeJoinMessageWithVersion(pass, 0x1362);

const makeJoinMessageWithVersion = (
	pass: string,
	version: number,
): { data: Buffer; previousMessage: Buffer } => {
	// Build previousMessage (PlayerInfo): 40 bytes, UTF-16LE player name
	// PlayerInfoMessage reads up to data.length bytes from previousMessage
	const prevMsg = Buffer.alloc(40, 0);
	const nameEncoded = Buffer.from("TestPlayer", "utf16le");
	nameEncoded.copy(prevMsg, 0);

	// Build join data according to actual BinaryField layout
	const data = Buffer.alloc(48, 0);
	data.writeUInt16LE(version, 0); // version at offset 0
	data.writeUInt16LE(0, 2); // padding/gametype
	data.writeUInt32LE(0, 4); // gameid at offset 4

	// pass at offset 8, max 20 UTF-16LE chars
	const passChars = pass.slice(0, 20);
	for (let i = 0; i < passChars.length; i++) {
		data.writeUInt16LE(passChars.charCodeAt(i), 8 + i * 2);
	}

	return { data, previousMessage: prevMsg };
};

// [size=9][0x02 error][0x04 VER_ERROR][code 3B][version 4962 LE]
const VERSION_ERROR_FRAME_HEX = "0900020400000062130000";

// ---- tests ----

describe("YGOProJoinHandler — strategy chain integration", () => {
	let emitter: EventEmitter;

	beforeEach(() => {
		emitter = new EventEmitter();
		JoinStrategyRegistry.setStrategies([
			new NostalgiaJoinStrategy({ getBanListHash: () => 1109 }),
			new DefaultJoinStrategy(),
		]);
		const rooms = YGOProRoomList.getRooms();
		while (rooms.length) {
			YGOProRoomList.deleteRoom(rooms[0]);
		}
		// Prevent real WaitingState setup and JOIN processing in these integration tests
		waitingSpy = jest.spyOn(YGOProRoom.prototype, "waiting").mockImplementation(() => undefined);
		roomEmitSpy = jest.spyOn(YGOProRoom.prototype, "emit").mockImplementation(() => undefined);
	});

	afterEach(() => {
		JoinStrategyRegistry.reset();
		waitingSpy.mockRestore();
		roomEmitSpy.mockRestore();
	});

	it("creates a fixed-format room for a valid environment identifier", async () => {
		// Listen for the JOIN emit that WaitingState would handle
		emitter.on("JOIN", jest.fn());

		const socket = makeSocket();
		const messageRepo = makeMessageRepository();
		const logger = makeLogger();

		new YGOProJoinHandler(emitter, logger as never, socket as never, messageRepo as never);

		const { data, previousMessage } = makeJoinMessage("1109#1001");
		emitter.emit(18 as unknown as string, { data, previousMessage });

		// Allow async ops to complete
		await new Promise((r) => setImmediate(r));

		const room = YGOProRoomList.findByAdmissionKey("1109#1001");
		expect(room).not.toBeNull();
	});

	it("iterates strategies in order — first matching strategy handles", async () => {
		const handled: string[] = [];

		const s1: JoinStrategy = {
			matches: (_ctx: JoinContext) => {
				handled.push("s1-matches");
				return false;
			},
			handle: jest.fn(),
		};
		const s2: JoinStrategy = {
			matches: (_ctx: JoinContext) => {
				handled.push("s2-matches");
				return true;
			},
			handle: jest.fn().mockResolvedValue(undefined),
		};
		const s3: JoinStrategy = {
			matches: jest.fn().mockReturnValue(true),
			handle: jest.fn(),
		};

		const registry = JoinStrategyRegistry.createForTests([s1, s2, s3]);

		const socket = makeSocket();
		const messageRepo = makeMessageRepository();
		const logger = makeLogger();

		const handler = new YGOProJoinHandler(
			emitter,
			logger as never,
			socket as never,
			messageRepo as never,
			registry,
		);

		const { data, previousMessage } = makeJoinMessage("ANYTHING");
		emitter.emit(18 as unknown as string, { data, previousMessage });

		await new Promise((r) => setImmediate(r));

		// s1 evaluated but did not match; s2 matched and handled; s3 never evaluated
		expect(handled).toContain("s1-matches");
		expect(handled).toContain("s2-matches");
		expect(s2.handle).toHaveBeenCalled();
		expect(s3.handle).not.toHaveBeenCalled();
	});

	it("YGOProJoinHandler uses the default registry when none is injected", () => {
		const socket = makeSocket();
		const messageRepo = makeMessageRepository();
		const logger = makeLogger();

		expect(() => {
			new YGOProJoinHandler(emitter, logger as never, socket as never, messageRepo as never);
		}).not.toThrow();
	});

	describe("protocol version gate", () => {
		const emitJoin = async (
			handlerEmitter: EventEmitter,
			pass: string,
			version: number,
		): Promise<void> => {
			const { data, previousMessage } = makeJoinMessageWithVersion(pass, version);
			await new Promise<void>((resolve) => {
				handlerEmitter.emit(18 as unknown as string, { data, previousMessage });
				setImmediate(resolve);
			});
		};

		it("rejects 0x1361 for an unknown room before any strategy runs or a room is created", async () => {
			const seen: string[] = [];
			const spy: JoinStrategy = {
				matches: (ctx: JoinContext) => {
					seen.push(`matches:${ctx.rawPass}`);
					return true;
				},
				handle: async (ctx: JoinContext) => {
					seen.push(`handle:${ctx.rawPass}`);
				},
			};
			JoinStrategyRegistry.setStrategies([spy]);

			const socket = makeSocket();
			const messageRepo = makeMessageRepository();
			const logger = makeLogger();
			const handlerEmitter = new EventEmitter();
			new YGOProJoinHandler(handlerEmitter, logger as never, socket as never, messageRepo as never);

			await emitJoin(handlerEmitter, "1109#1001", 0x1361);

			// no strategy was matched or handled
			expect(seen).toHaveLength(0);
			expect(YGOProRoomList.getRooms()).toHaveLength(0);

			// the two deny frames, in order: VersionError then the upgrade hint
			expect(socket.send).toHaveBeenCalledTimes(2);
			expect(socket.send.mock.calls[0][0].toString("hex")).toBe(VERSION_ERROR_FRAME_HEX);
			const hint = new YGOProStocChat().fromFullPayload(socket.send.mock.calls[1][0] as Buffer);
			expect(hint.player_type).toBe(0x09);
			expect(hint.msg).toContain("0x1362");
			expect(hint.msg).toContain("升级客户端");

			expect(socket.close).toHaveBeenCalledTimes(1);
		});

		it("logs the protocol version mismatch as structured context", async () => {
			const socket = makeSocket();
			const messageRepo = makeMessageRepository();
			const logger = makeLogger();
			const handlerEmitter = new EventEmitter();
			new YGOProJoinHandler(handlerEmitter, logger as never, socket as never, messageRepo as never);

			await emitJoin(handlerEmitter, "1109#1001", 0x1361);

			const warnCall = logger.warn.mock.calls.find(
				(call) =>
					typeof call[1] === "object" &&
					call[1] !== null &&
					(call[1] as { reason?: string }).reason === "unsupported_protocol_version",
			);
			expect(warnCall).toBeDefined();
			expect(warnCall?.[1]).toEqual({
				reason: "unsupported_protocol_version",
				actualVersion: 0x1361,
				expectedVersion: 0x1362,
			});
		});

		it.each([
			0x1360, 0x1363,
		])("rejects version 0x%x with the version frames and a close before any strategy runs", async (version) => {
			const seen: string[] = [];
			const spy: JoinStrategy = {
				matches: (ctx: JoinContext) => {
					seen.push(`matches:${ctx.rawPass}`);
					return true;
				},
				handle: async (ctx: JoinContext) => {
					seen.push(`handle:${ctx.rawPass}`);
				},
			};
			JoinStrategyRegistry.setStrategies([spy]);

			const socket = makeSocket();
			const messageRepo = makeMessageRepository();
			const logger = makeLogger();
			const handlerEmitter = new EventEmitter();
			new YGOProJoinHandler(handlerEmitter, logger as never, socket as never, messageRepo as never);

			await emitJoin(handlerEmitter, "1109#1001", version);

			expect(seen).toHaveLength(0);
			expect(YGOProRoomList.getRooms()).toHaveLength(0);
			expect(socket.send).toHaveBeenCalledTimes(2);
			expect(socket.send.mock.calls[0][0].toString("hex")).toBe(VERSION_ERROR_FRAME_HEX);
			expect(socket.close).toHaveBeenCalledTimes(1);
		});

		it("still admits 0x1362 without sending an upgrade hint", async () => {
			// uses the registry chain installed in beforeEach
			const socket = makeSocket();
			const messageRepo = makeMessageRepository();
			const logger = makeLogger();
			const handlerEmitter = new EventEmitter();
			new YGOProJoinHandler(handlerEmitter, logger as never, socket as never, messageRepo as never);

			await emitJoin(handlerEmitter, "1109#1001", 0x1362);

			const room = YGOProRoomList.findByAdmissionKey("1109#1001");
			expect(room).not.toBeNull();
			expect(socket.send).not.toHaveBeenCalled();
			expect(socket.close).not.toHaveBeenCalled();
		});

		it("sends Chinese explanation frame before JOINERROR and closes gracefully on JoinRejectionError", async () => {
			const rejectingStrategy: JoinStrategy = {
				matches: () => true,
				handle: async () => {
					throw new JoinRejectionError(
						"Internal failure reason",
						"排位登录格式错误：请将玩家名填写为“昵称$4位数字PIN”，完整内容不能超过20个字符（例如：玩家$1234）。",
					);
				},
			};
			JoinStrategyRegistry.setStrategies([rejectingStrategy]);

			const sendCalls: Buffer[] = [];
			const actions: string[] = [];
			const socket = {
				...makeSocket(),
				send: jest.fn().mockImplementation((buf: Buffer) => {
					sendCalls.push(buf);
					actions.push("send");
				}),
				close: jest.fn().mockImplementation(() => {
					actions.push("close");
				}),
			};
			const messageRepo = {
				...makeMessageRepository(),
				errorMessage: jest.fn().mockReturnValue(Buffer.from([0x04, 0x00, 0x14, 0x01])),
			};
			const logger = makeLogger();
			const handlerEmitter = new EventEmitter();
			new YGOProJoinHandler(handlerEmitter, logger as never, socket as never, messageRepo as never);

			await emitJoin(handlerEmitter, "1109#TT", 0x1362);

			expect(actions).toEqual(["send", "send", "close"]);
			expect(sendCalls).toHaveLength(2);
			// First frame: chat message (0x19)
			expect(sendCalls[0][2]).toBe(0x19);
			// Second frame: JOINERROR frame
			expect(sendCalls[1].toString("hex")).toBe("04001401");
			expect(socket.close).toHaveBeenCalledTimes(1);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Internal failure reason"));
		});
	});
});
