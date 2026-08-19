// Room teardown (FinalizeYGOProRoom) broadcasts via WebSocketSingleton, which
// binds a fixed production port. Mock it so contract tests never bind it.
jest.mock("../web-socket-server/WebSocketSingleton", () => {
	const mockBroadcast = jest.fn();
	return {
		__esModule: true,
		default: {
			getInstance: () => ({ broadcast: mockBroadcast }),
		},
	};
});

import net from "net";

import {
	JOIN_GAME_FRAME_HEX,
	JOIN_GAME_PAYLOAD_HEX,
	PLAYER_INFO_FRAME_HEX,
	YGOPRO_FIRST_PACKET,
} from "@test-support/fixtures/ygopro-first-packet";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { DefaultJoinStrategy } from "@ygopro/room/application/join-strategies/DefaultJoinStrategy";
import { JoinContext, JoinStrategy } from "@ygopro/room/application/join-strategies/JoinStrategy";
import { JoinStrategyRegistry } from "@ygopro/room/application/join-strategies/JoinStrategyRegistry";
import YGOProRoomList from "@ygopro/room/infrastructure/YGOProRoomList";
import {
	YGOProStocHsPlayerEnter,
	YGOProStocJoinGame,
	YGOProStocTypeChange,
} from "ygopro-msg-encode";

import { YGOProServer } from "./YGOProServer";

jest.setTimeout(10_000);

/** Wraps the real strategy chain and records every context that reaches it. */
class RecordingJoinStrategy implements JoinStrategy {
	public readonly contexts: JoinContext[] = [];

	constructor(private readonly inner: JoinStrategy) {}

	matches(ctx: JoinContext): boolean {
		return this.inner.matches(ctx);
	}

	async handle(ctx: JoinContext): Promise<void> {
		this.contexts.push(ctx);
		await this.inner.handle(ctx);
	}
}

/**
 * Registered AFTER the recording wrapper. The real chain's terminal fallback
 * (DefaultJoinStrategy always matches), so any context reaching this trap
 * means a rejected join fell through to a later strategy.
 */
class TrapJoinStrategy implements JoinStrategy {
	public readonly handled: JoinContext[] = [];

	matches(_ctx: JoinContext): boolean {
		return true;
	}

	async handle(ctx: JoinContext): Promise<void> {
		this.handled.push(ctx);
	}
}

// ---------- handcrafted frame builders (failure variants) ----------
// Independent of the encoder under test; a dedicated test pins them to the
// hand-verified fixed sample so they cannot silently drift from the wire format.

const encodeUtf16LE = (text: string, slots: number): Buffer => {
	const buffer = Buffer.alloc(slots * 2);
	for (let i = 0; i < Math.min(text.length, slots); i++) {
		buffer.writeUInt16LE(text.charCodeAt(i), i * 2);
	}
	return buffer;
};

const buildFrame = (command: number, payload: Buffer): Buffer => {
	const header = Buffer.alloc(3);
	header.writeUInt16LE(payload.length + 1, 0);
	header.writeUInt8(command, 2);
	return Buffer.concat([header, payload]);
};

const buildPlayerInfoFrame = (name: string): Buffer => buildFrame(0x10, encodeUtf16LE(name, 20));

const buildJoinGameFrame = (pass: string, version = 0x1362): Buffer => {
	const payload = Buffer.alloc(48);
	payload.writeUInt16LE(version, 0);
	payload.writeUInt16LE(0xcccc, 2);
	payload.writeUInt32LE(42, 4);
	encodeUtf16LE(pass, 20).copy(payload, 8);
	return buildFrame(0x12, payload);
};

const buildFirstPacket = (name: string, pass: string, version = 0x1362): Buffer =>
	Buffer.concat([buildPlayerInfoFrame(name), buildJoinGameFrame(pass, version)]);

// [size=9][0x02 error][0x04 VER_ERROR][code 3B][version 4962 LE]
const VERSION_ERROR_FRAME_HEX = "0900020400000062130000";
// [size=6][0x02 error][0x01 JOIN_ERROR][code 4B]
const JOIN_ERROR_FRAME_HEX = "0600020100000000";

/** Decodes the UTF-16 text of the custom ServerError (0xf3) frame. */
const decodeServerErrorText = (frame: Buffer): string => {
	const chars: string[] = [];
	// frame = [size 2B][0xf3][0x04][0x00][40 zero bytes][message 512B]
	for (let offset = 45; offset + 1 < frame.length; offset += 2) {
		const code = frame.readUInt16LE(offset);
		if (code === 0) {
			break;
		}
		chars.push(String.fromCharCode(code));
	}
	return chars.join("");
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const splitFrames = (data: Buffer): Buffer[] => {
	const frames: Buffer[] = [];
	let offset = 0;
	while (offset + 2 <= data.length) {
		const frameLength = data.readUInt16LE(offset);
		const frameEnd = offset + 2 + frameLength;
		if (frameEnd > data.length) {
			break;
		}
		frames.push(data.subarray(offset, frameEnd));
		offset = frameEnd;
	}
	return frames;
};

describe("YGOProServer · TCP admission contract", () => {
	let server: YGOProServer;
	let recording: RecordingJoinStrategy;
	let trap: TrapJoinStrategy;

	const waitForListening = async (): Promise<net.AddressInfo> => {
		for (let attempt = 0; attempt < 100; attempt++) {
			const address = server.boundAddress;
			if (address && typeof address === "object") {
				return address;
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error("YGOProServer did not start listening on the temporary port");
	};

	const connect = (port: number): Promise<net.Socket> =>
		new Promise((resolve) => {
			const socket = net.connect(port, "127.0.0.1");
			socket.on("error", () => {
				// Server-side destroy() may surface ECONNRESET on the peer socket.
			});
			socket.on("connect", () => resolve(socket));
		});

	const receiveFrames = (socket: net.Socket, count: number): Promise<Buffer[]> =>
		new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			const timer = setTimeout(() => {
				reject(new Error("timed out waiting for the join response frames"));
			}, 5000);
			socket.on("data", (chunk: Buffer) => {
				chunks.push(chunk);
				const frames = splitFrames(Buffer.concat(chunks));
				if (frames.length >= count) {
					clearTimeout(timer);
					resolve(frames);
				}
			});
		});

	const waitForClose = (socket: net.Socket): Promise<void> =>
		new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("timed out waiting for the connection to close"));
			}, 5000);
			socket.on("close", () => {
				clearTimeout(timer);
				resolve();
			});
		});

	const collectUntilClose = (socket: net.Socket): Promise<Buffer[]> =>
		new Promise((resolve) => {
			const chunks: Buffer[] = [];
			socket.on("data", (chunk: Buffer) => chunks.push(chunk));
			socket.on("close", () => resolve(chunks));
		});

	/** Creates + admits the room host and waits for its three join responses. */
	const hostRoom = async (port: number, pass = "room1"): Promise<net.Socket> => {
		const socket = await connect(port);
		const framesPromise = receiveFrames(socket, 3);
		socket.write(buildFirstPacket("Jaden", pass));
		await framesPromise;
		return socket;
	};

	/** Connects and completes a successful join, proving the server is healthy. */
	const joinSuccessfully = async (port: number, name: string, pass: string): Promise<void> => {
		const socket = await connect(port);
		const framesPromise = receiveFrames(socket, 3);
		socket.write(buildFirstPacket(name, pass));
		const frames = await framesPromise;
		expect(new YGOProStocJoinGame().fromFullPayload(frames[0]).info.duel_rule).toBe(5);
		socket.destroy();
	};

	beforeEach(() => {
		recording = new RecordingJoinStrategy(new DefaultJoinStrategy());
		trap = new TrapJoinStrategy();
		JoinStrategyRegistry.setStrategies([recording, trap]);
		server = new YGOProServer(new LoggerMock());
		server.initialize(0);
	});

	afterEach(() => {
		for (const room of [...YGOProRoomList.getRooms()]) {
			YGOProRoomList.deleteRoom(room);
		}
		JoinStrategyRegistry.setStrategies([new DefaultJoinStrategy()]);
		server.close();
	});

	it("admits the fixed first packet and answers with YGOPro wire-format join responses", async () => {
		const { port } = await waitForListening();
		const socket = await connect(port);
		const framesPromise = receiveFrames(socket, 3);

		socket.write(YGOPRO_FIRST_PACKET);
		const frames = await framesPromise;

		expect(recording.contexts).toHaveLength(1);
		const context = recording.contexts[0];
		expect(context.playerInfo.name).toBe("Jaden");
		expect(context.rawPass).toBe("room1");
		expect(context.command).toBe("room1");
		expect(context.password).toBe("");
		expect(context.message.data).toEqual(Buffer.from(JOIN_GAME_PAYLOAD_HEX, "hex"));

		const joinGame = new YGOProStocJoinGame().fromFullPayload(frames[0]);
		expect(joinGame.info.duel_rule).toBe(5);
		expect(joinGame.info.rule).toBe(1);

		const typeChange = new YGOProStocTypeChange().fromFullPayload(frames[1]);
		expect(typeChange.isHost).toBe(true);
		expect(typeChange.playerPosition).toBe(0);

		const playerEnter = new YGOProStocHsPlayerEnter().fromFullPayload(frames[2]);
		expect(playerEnter.name).toBe("Jaden");
		expect(playerEnter.pos).toBe(0);

		socket.destroy();
	});

	describe("failure contract", () => {
		it("handcrafted failure-variant builders reproduce the fixed first-packet sample", () => {
			expect(buildPlayerInfoFrame("Jaden").toString("hex")).toBe(PLAYER_INFO_FRAME_HEX);
			expect(buildJoinGameFrame("room1").toString("hex")).toBe(JOIN_GAME_FRAME_HEX);
		});

		it("rejects an unsupported client version with a version-error frame before closing", async () => {
			const { port } = await waitForListening();
			const host = await hostRoom(port);

			const client = await connect(port);
			const framesPromise = receiveFrames(client, 1);
			const closedPromise = waitForClose(client);
			client.write(buildFirstPacket("Chazz", "room1", 0x1361));

			const frames = await framesPromise;
			await closedPromise;

			expect(frames[0].toString("hex")).toBe(VERSION_ERROR_FRAME_HEX);

			// exactly one strategy invocation for the rejected join, no fallthrough
			expect(recording.contexts).toHaveLength(2);
			expect(trap.handled).toHaveLength(0);

			// the room and its host are unaffected
			const room = YGOProRoomList.findByName("room1");
			expect(room).not.toBeNull();
			expect(room?.players).toHaveLength(1);

			host.destroy();
		});

		it("silently destroys a wrong-password join without falling through to other strategies", async () => {
			const { port } = await waitForListening();
			const host = await hostRoom(port, "room1#secret");

			const client = await connect(port);
			const dataPromise = collectUntilClose(client);
			client.write(buildFirstPacket("Chazz", "room1#wrong"));

			const received = await dataPromise;
			expect(Buffer.concat(received)).toHaveLength(0);

			expect(recording.contexts).toHaveLength(2);
			expect(trap.handled).toHaveLength(0);

			const room = YGOProRoomList.findByName("room1");
			expect(room).not.toBeNull();
			expect(room?.players).toHaveLength(1);

			host.destroy();
		});

		it("rejects a duplicate player name with server-error and join-error frames before closing", async () => {
			const { port } = await waitForListening();
			const host = await hostRoom(port); // host name "Jaden"

			const client = await connect(port);
			const framesPromise = receiveFrames(client, 2);
			const closedPromise = waitForClose(client);
			client.write(buildFirstPacket("Jaden", "room1"));

			const frames = await framesPromise;
			await closedPromise;

			// frame[0]: custom ServerError (0xf3) carrying the duplicate-name message
			expect(frames[0].readUInt16LE(0)).toBe(555);
			expect(frames[0].length).toBe(557);
			expect(frames[0][2]).toBe(0xf3);
			expect(decodeServerErrorText(frames[0])).toContain(
				"Already exists a player with the name :Jaden",
			);
			// frame[1]: JOIN_ERROR error frame
			expect(frames[1].toString("hex")).toBe(JOIN_ERROR_FRAME_HEX);

			expect(recording.contexts).toHaveLength(2);
			expect(trap.handled).toHaveLength(0);

			const room = YGOProRoomList.findByName("room1");
			expect(room).not.toBeNull();
			expect(room?.players).toHaveLength(1);

			host.destroy();
		});

		it("ignores an unknown command and still admits a later join on the same connection", async () => {
			const { port } = await waitForListening();
			const client = await connect(port);
			const framesPromise = receiveFrames(client, 3);

			client.write(buildFrame(0x99, Buffer.from([0x01, 0x02, 0x03, 0x04])));
			client.write(buildFirstPacket("Jaden", "room1"));
			const frames = await framesPromise;

			expect(new YGOProStocJoinGame().fromFullPayload(frames[0]).info.duel_rule).toBe(5);
			expect(recording.contexts).toHaveLength(1);
			expect(YGOProRoomList.findByName("room1")).not.toBeNull();

			client.destroy();
		});

		it("destroys the connection on a zero-length frame without touching rooms or other connections", async () => {
			const { port } = await waitForListening();

			const client = await connect(port);
			const dataPromise = collectUntilClose(client);
			// valid PlayerInfo, then an illegal zero-length prefix: nothing after it
			// (including the trailing JoinGame) may be processed
			client.write(
				Buffer.concat([
					buildPlayerInfoFrame("Jaden"),
					Buffer.from([0x00, 0x00]),
					buildJoinGameFrame("room1"),
				]),
			);
			const received = await dataPromise;
			expect(Buffer.concat(received)).toHaveLength(0);

			expect(recording.contexts).toHaveLength(0);
			expect(YGOProRoomList.getRooms()).toHaveLength(0);

			await joinSuccessfully(port, "Jaden", "room1");
			expect(recording.contexts).toHaveLength(1);
		});

		it("destroys the connection on an oversized frame length without touching rooms", async () => {
			const { port } = await waitForListening();

			const client = await connect(port);
			const dataPromise = collectUntilClose(client);
			client.write(
				Buffer.concat([
					buildPlayerInfoFrame("Jaden"),
					Buffer.from([0xff, 0xff]),
					buildJoinGameFrame("room1"),
				]),
			);
			const received = await dataPromise;
			expect(Buffer.concat(received)).toHaveLength(0);

			expect(recording.contexts).toHaveLength(0);
			expect(YGOProRoomList.getRooms()).toHaveLength(0);

			await joinSuccessfully(port, "Jaden", "room1");
		});

		it("leaves no room behind when the client disconnects mid-frame", async () => {
			const { port } = await waitForListening();

			const client = await connect(port);
			// 40 bytes: full ExternalAddress frame + a truncated PlayerInfo frame
			await new Promise<void>((resolve) =>
				client.write(YGOPRO_FIRST_PACKET.subarray(0, 40), () => resolve()),
			);
			client.destroy();
			await sleep(100);

			expect(recording.contexts).toHaveLength(0);
			expect(YGOProRoomList.getRooms()).toHaveLength(0);

			// the server keeps admitting new connections
			await joinSuccessfully(port, "Jaden", "room1");
			expect(recording.contexts).toHaveLength(1);
		});

		it("leaves no room behind when the client disconnects between PlayerInfo and JoinGame", async () => {
			const { port } = await waitForListening();

			const client = await connect(port);
			await new Promise<void>((resolve) =>
				client.write(buildPlayerInfoFrame("Jaden"), () => resolve()),
			);
			client.destroy();
			await sleep(100);

			expect(recording.contexts).toHaveLength(0);
			expect(YGOProRoomList.getRooms()).toHaveLength(0);

			await joinSuccessfully(port, "Jaden", "room1");
			expect(recording.contexts).toHaveLength(1);
		});
	});
});
