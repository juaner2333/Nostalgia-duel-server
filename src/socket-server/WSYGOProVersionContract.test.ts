/**
 * Real WebSocket contract for the YGOPro protocol version gate.
 *
 * Drives a real WSYGOProServer over a real `ws` client on a temporary port and
 * asserts that an unsupported protocol version (0x1361) receives exactly two
 * frames — the YGOPro VersionError followed by the readable upgrade hint —
 * and that both frames are delivered before the connection closes. Also
 * verifies a valid 0x1362 join still works and receives no upgrade hint.
 */

jest.mock("../web-socket-server/WebSocketSingleton", () => {
	const mockBroadcast = jest.fn();
	return {
		__esModule: true,
		default: {
			getInstance: () => ({ broadcast: mockBroadcast }),
		},
	};
});

import WebSocket from "ws";

import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { DefaultJoinStrategy } from "@ygopro/room/application/join-strategies/DefaultJoinStrategy";
import { JoinStrategyRegistry } from "@ygopro/room/application/join-strategies/JoinStrategyRegistry";
import { NostalgiaJoinStrategy } from "@ygopro/room/application/join-strategies/NostalgiaJoinStrategy";
import YGOProRoomList from "@ygopro/room/infrastructure/YGOProRoomList";
import { YGOProStocChat } from "ygopro-msg-encode";

import { WSYGOProServer } from "./WSYGOProServer";
import { HandshakeTicketAuthenticator } from "./HandshakeTicketAuthenticator";
import { TicketRepository } from "../shared/ticket/domain/TicketRepository";

jest.setTimeout(10_000);

// ---------- wire-format builders (independent of the code under test) ----------

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

const buildFirstPacket = (name: string, pass: string, version: number): Buffer => {
	const playerInfo = buildFrame(0x10, encodeUtf16LE(name, 20));
	const payload = Buffer.alloc(48);
	payload.writeUInt16LE(version, 0);
	payload.writeUInt16LE(0xcccc, 2);
	payload.writeUInt32LE(42, 4);
	encodeUtf16LE(pass, 20).copy(payload, 8);
	const joinGame = buildFrame(0x12, payload);
	return Buffer.concat([playerInfo, joinGame]);
};

// [size=9][0x02 error][0x04 VER_ERROR][code 3B][version 4962 LE]
const VERSION_ERROR_FRAME_HEX = "0900020400000062130000";

const commandOf = (frame: Buffer): number => frame[2];

// An anonymous connection never carries a ticket, so the repository is never
// consulted: extractToken returns undefined and authenticate yields anonymous.
const ticketStub: TicketRepository = { consume: jest.fn().mockResolvedValue(null) };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const toBuffer = (data: WebSocket.RawData): Buffer => {
	if (Array.isArray(data)) {
		return Buffer.concat(data);
	}
	if (data instanceof ArrayBuffer) {
		return Buffer.from(data);
	}
	// Otherwise data is a Buffer (a Uint8Array view); copy the exact slice to
	// avoid any shared-pool reuse surprises.
	return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
};

// ---------- test ----------

describe("WSYGOProServer · protocol version gate", () => {
	let server: WSYGOProServer;

	const waitForListening = async (): Promise<number> => {
		for (let attempt = 0; attempt < 100; attempt++) {
			const address = server.boundAddress;
			if (address && typeof address === "object") {
				return (address as { port: number }).port;
			}
			await sleep(10);
		}
		throw new Error("WSYGOProServer did not start listening on the temporary port");
	};

	const connectClient = (port: number): Promise<WebSocket> =>
		new Promise((resolve, reject) => {
			const client = new WebSocket(`ws://127.0.0.1:${port}`);
			client.on("open", () => resolve(client));
			client.on("error", reject);
		});

	beforeEach(() => {
		JoinStrategyRegistry.setStrategies([
			new NostalgiaJoinStrategy({ getBanListHash: () => 1109 }),
			new DefaultJoinStrategy(),
		]);
		server = new WSYGOProServer(
			new LoggerMock(),
			new HandshakeTicketAuthenticator(ticketStub),
			60_000,
		);
		server.initialize(0);
	});

	afterEach(() => {
		for (const room of [...YGOProRoomList.getRooms()]) {
			YGOProRoomList.deleteRoom(room);
		}
		JoinStrategyRegistry.reset();
		server.close();
	});

	it("delivers the VersionError and upgrade-hint frames before closing a 0x1361 join", async () => {
		const port = await waitForListening();
		const client = await connectClient(port);

		const messages: Buffer[] = [];
		const closeSeen = new Promise<void>((resolve) => client.on("close", () => resolve()));
		client.on("message", (data: WebSocket.RawData) => {
			messages.push(toBuffer(data));
		});

		client.send(buildFirstPacket("Syrus", "1109#1001", 0x1361));
		await closeSeen;

		// exactly two messages, delivered before the close event, no room created
		expect(messages).toHaveLength(2);
		expect(messages[0].toString("hex")).toBe(VERSION_ERROR_FRAME_HEX);
		const hint = new YGOProStocChat().fromFullPayload(messages[1]);
		expect(hint.player_type).toBe(0x09);
		expect(hint.msg).toContain("0x1362");
		expect(hint.msg).toContain("升级客户端");

		expect(YGOProRoomList.getRooms()).toHaveLength(0);
	});

	it("accepts a 0x1362 join over WebSocket without sending an upgrade hint", async () => {
		const port = await waitForListening();
		const client = await connectClient(port);

		const messages: Buffer[] = [];
		client.on("message", (data: WebSocket.RawData) => {
			messages.push(toBuffer(data));
		});

		client.send(buildFirstPacket("Jaden", "1109#1001", 0x1362));

		// normal join responses arrive (JOIN_GAME 0x12); wait for them
		for (
			let attempt = 0;
			attempt < 200 && messages.findIndex((m) => commandOf(m) === 0x12) === -1;
			attempt++
		) {
			await sleep(10);
		}
		await sleep(50);

		expect(YGOProRoomList.findByAdmissionKey("1109#1001")).not.toBeNull();
		const commands = messages.map(commandOf);
		expect(commands).toContain(0x12);
		// the upgrade hint (STOC_CHAT 0x19) is never sent to a supported client
		expect(commands).not.toContain(0x19);

		client.close();
	});
});
