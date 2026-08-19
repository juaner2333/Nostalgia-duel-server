/**
 * Real-WebSocket contract tests for the YGOPro WS server.
 *
 * Each supported WS-side contract is verified independently over a real `ws`
 * connection on an ephemeral port: handshake ticket authentication, the
 * first-message race (frames arriving while the ticket check is in flight),
 * the application-level ping/pong echo, token (0xfd) reconnect, and the
 * heartbeat sweep. The TCP first-packet contract lives in YGOProServer.test.ts
 * and YGOProRoomLifecycle.test.ts — the two transports never share assertions.
 *
 * The sql.js card database lives outside the repo (resources/ is untracked),
 * so the card repository port is replaced at the module boundary. Everything
 * between it and the wire (ws server, ticket authenticator, join strategies,
 * room state machine, deck validation chain, reconnect tokens) is real.
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

// Card "database": known codes resolve to an OCG+TCG normal monster; anything
// else is an unknown card. Keeps the real deck-build + validation chain intact
// without the sql.js card-storage worker.
jest.mock("@ygopro/card/infrastructure/CardYGOProRepository", () => {
	const { Card } = jest.requireActual("@shared/card/domain/Card");
	const KNOWN_CARDS = new Set([89631139, 54098462, 78748425]);
	return {
		CardYGOProRepository: class {
			async findByCode(code: string) {
				if (!KNOWN_CARDS.has(Number(code))) {
					return null;
				}
				return new Card({
					alias: "0",
					code,
					type: 0x11, // normal monster — never an extra-deck card
					category: 0,
					variant: 3, // OCG | TCG
				});
			}
		},
	};
});

// The Postgres user-profile port is stubbed so the authenticated admission path
// stays in-process: an unknown userId degrades to a guest credential instead of
// hitting TypeORM (no entity metadata exists inside jest).
jest.mock("@shared/user-profile/infrastructure/postgres/UserProfilePostgresRepository", () => ({
	UserProfilePostgresRepository: class {
		async findById(_userId: string) {
			return null;
		}

		async isBanned(_userId: string) {
			return false;
		}
	},
}));

import { randomBytes } from "crypto";
import net from "net";
import { WebSocket } from "ws";

import { TokenIndex } from "@shared/room/domain/TokenIndex";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { DefaultJoinStrategy } from "@ygopro/room/application/join-strategies/DefaultJoinStrategy";
import { JoinStrategyRegistry } from "@ygopro/room/application/join-strategies/JoinStrategyRegistry";
import YGOProRoomList from "@ygopro/room/infrastructure/YGOProRoomList";

import { HandshakeTicketAuthenticator } from "./HandshakeTicketAuthenticator";
import { WSYGOProServer } from "./WSYGOProServer";

jest.setTimeout(10_000);

const HEARTBEAT_MS = 100;

// ---------- test doubles ----------

/** Programmable TicketRepository: recorded calls, optional latency, per-ticket results. */
class FakeTicketRepository {
	readonly consumeCalls: string[] = [];
	delayMs = 0;
	private readonly results = new Map<string, string>();

	admit(ticket: string, userId: string): void {
		this.results.set(ticket, userId);
	}

	async consume(uuid: string): Promise<string | null> {
		this.consumeCalls.push(uuid);
		if (this.delayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, this.delayMs));
		}
		return this.results.get(uuid) ?? null;
	}
}

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

const buildPlayerInfoFrame = (name: string): Buffer => buildFrame(0x10, encodeUtf16LE(name, 20));

const buildJoinGameFrame = (pass: string): Buffer => {
	const payload = Buffer.alloc(48);
	payload.writeUInt16LE(0x1362, 0); // mercuryConfig.version
	payload.writeUInt16LE(0xcccc, 2);
	payload.writeUInt32LE(42, 4);
	encodeUtf16LE(pass, 20).copy(payload, 8);
	return buildFrame(0x12, payload);
};

const buildUpdateDeckFrame = (main: number[]): Buffer => {
	const payload = Buffer.alloc(8 + main.length * 4);
	payload.writeUInt32LE(main.length, 0);
	let offset = 8;
	for (const code of main) {
		payload.writeUInt32LE(code, offset);
		offset += 4;
	}
	return buildFrame(0x02, payload);
};

const buildTryStartFrame = (): Buffer => buildFrame(37, Buffer.alloc(0));
const buildReconnectFrame = (token: string): Buffer => buildFrame(0xfd, Buffer.from(token, "utf8"));

const VALID_MAIN_DECK = (): number[] => Array<number>(40).fill(89631139);

// ---------- socket-side helpers ----------

const commandOf = (frame: Buffer): number => frame[2];

/** Records every binary message arriving on a WebSocket client. */
class WsFrameTap {
	private frames: Buffer[] = [];

	constructor(ws: WebSocket) {
		ws.on("message", (data: Buffer) => {
			this.frames.push(data);
		});
		ws.on("error", () => {
			// socket errors surface via close; assertions never depend on them
		});
	}

	commands(): number[] {
		return this.frames.map(commandOf);
	}

	framesWithCommand(command: number): Buffer[] {
		return this.frames.filter((frame) => commandOf(frame) === command);
	}

	async waitFor(predicate: (frames: Buffer[]) => boolean, timeoutMs = 5000): Promise<Buffer[]> {
		const deadline = Date.now() + timeoutMs;
		while (!predicate(this.frames)) {
			if (Date.now() > deadline) {
				throw new Error(
					`timed out waiting for frames; commands so far: ${this.commands()
						.map((command) => `0x${command.toString(16)}`)
						.join(" ")}`,
				);
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return this.frames;
	}
}

const hasCommand = (frames: Buffer[], command: number): boolean =>
	frames.some((frame) => commandOf(frame) === command);

const waitForCloseOn = (ws: WebSocket, timeoutMs = 5000): Promise<void> =>
	new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error("timed out waiting for the WebSocket to close"));
		}, timeoutMs);
		ws.on("close", () => {
			clearTimeout(timer);
			resolve();
		});
	});

const waitForCloseOnRaw = (socket: net.Socket, timeoutMs = 5000): Promise<void> =>
	new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error("timed out waiting for the raw socket to close"));
		}, timeoutMs);
		socket.on("close", () => {
			clearTimeout(timer);
			resolve();
		});
	});

// ---------- test ----------

describe("WSYGOProServer · real WebSocket contract", () => {
	let server: WSYGOProServer;
	let tickets: FakeTicketRepository;

	const waitForListening = async (): Promise<number> => {
		for (let attempt = 0; attempt < 100; attempt++) {
			const address = server.boundAddress;
			if (address && typeof address === "object") {
				return address.port;
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error("WSYGOProServer did not start listening on the temporary port");
	};

	const connectWs = async (port: number, query = ""): Promise<{ ws: WebSocket; tap: WsFrameTap }> =>
		new Promise((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}${query}`);
			const timer = setTimeout(() => reject(new Error("WebSocket client did not open")), 5000);
			ws.on("error", () => {
				// open failures surface via the timeout
			});
			ws.on("open", () => {
				clearTimeout(timer);
				resolve({ ws, tap: new WsFrameTap(ws) });
			});
		});

	const joinRoom = async (
		port: number,
		name: string,
		roomName: string,
	): Promise<{ ws: WebSocket; tap: WsFrameTap }> => {
		const { ws, tap } = await connectWs(port);
		ws.send(buildPlayerInfoFrame(name));
		ws.send(buildJoinGameFrame(roomName));
		await tap.waitFor(
			(frames) => hasCommand(frames, 0x12) && hasCommand(frames, 0x13), // JOIN_GAME + TYPE_CHANGE
		);
		return { ws, tap };
	};

	const submitDeck = async (ws: WebSocket, tap: WsFrameTap): Promise<void> => {
		ws.send(buildUpdateDeckFrame(VALID_MAIN_DECK()));
		await tap.waitFor((frames) => hasCommand(frames, 0x21)); // PLAYER_CHANGE
	};

	beforeEach(() => {
		JoinStrategyRegistry.setStrategies([new DefaultJoinStrategy()]);
		tickets = new FakeTicketRepository();
		server = new WSYGOProServer(
			new LoggerMock(),
			new HandshakeTicketAuthenticator(tickets),
			HEARTBEAT_MS,
		);
		server.initialize(0);
	});

	afterEach(() => {
		for (const room of [...YGOProRoomList.getRooms()]) {
			YGOProRoomList.deleteRoom(room);
		}
		TokenIndex.getInstance().clear();
		JoinStrategyRegistry.setStrategies([new DefaultJoinStrategy()]);
		server.close();
	});

	it("closes the connection on a rejected ticket without admitting it to any room", async () => {
		const port = await waitForListening();
		const { ws, tap } = await connectWs(port, "?ticket=stale");

		// join frames racing the ticket check must never be dispatched
		ws.send(buildPlayerInfoFrame("Jaden"));
		ws.send(buildJoinGameFrame("room1"));
		await waitForCloseOn(ws);

		expect(tickets.consumeCalls).toEqual(["stale"]);
		expect(tap.framesWithCommand(0x12)).toHaveLength(0); // no join response
		expect(YGOProRoomList.getRooms()).toHaveLength(0);
	});

	it("admits an anonymous connection without a ticket", async () => {
		const port = await waitForListening();
		const { ws, tap } = await connectWs(port);

		ws.send(buildPlayerInfoFrame("Jaden"));
		ws.send(buildJoinGameFrame("room1"));
		await tap.waitFor((frames) => hasCommand(frames, 0x12) && hasCommand(frames, 0x13));

		expect(tickets.consumeCalls).toHaveLength(0);
		expect(YGOProRoomList.findByName("room1")?.players).toHaveLength(1);
		ws.close();
	});

	it("buffers first frames that race the ticket check and dispatches them once it resolves", async () => {
		const port = await waitForListening();
		tickets.delayMs = 250;
		tickets.admit("valid-ticket", "user-1");

		const { ws, tap } = await connectWs(port, "?ticket=valid-ticket");
		ws.send(buildPlayerInfoFrame("Jaden"));
		ws.send(buildJoinGameFrame("room1"));

		// while the ticket check is still in flight, no frame is dispatched
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(tap.framesWithCommand(0x12)).toHaveLength(0);

		// once authentication resolves, the buffered frames are dispatched
		await tap.waitFor((frames) => hasCommand(frames, 0x12) && hasCommand(frames, 0x13));
		expect(tickets.consumeCalls).toEqual(["valid-ticket"]);
		expect(YGOProRoomList.findByName("room1")?.players).toHaveLength(1);
		expect(ws.readyState).toBe(WebSocket.OPEN);
		ws.close();
	});

	it("echoes an application-level ping (0xff) as a pong (0xfe) with the payload preserved", async () => {
		const port = await waitForListening();
		const { ws, tap } = await connectWs(port);

		const ping = buildFrame(0xff, Buffer.from([0xde, 0xad, 0xbe]));
		ws.send(ping);
		await tap.waitFor((frames) => hasCommand(frames, 0xfe));

		const pong = tap.framesWithCommand(0xfe)[0];
		expect(pong.subarray(3)).toEqual(ping.subarray(3));
		expect(tap.framesWithCommand(0x12)).toHaveLength(0); // no join side effects
		expect(ws.readyState).toBe(WebSocket.OPEN);
		ws.close();
	});

	it("re-admits a dropped player via a token reconnect on a fresh WebSocket", async () => {
		const port = await waitForListening();
		const host = await joinRoom(port, "Jaden", "room1");
		const guest = await joinRoom(port, "Chazz", "room1");

		await submitDeck(host.ws, host.tap);
		await submitDeck(guest.ws, guest.tap);

		host.ws.send(buildTryStartFrame());
		await Promise.all([
			host.tap.waitFor((frames) => hasCommand(frames, 0x15)), // DUEL_START
			guest.tap.waitFor((frames) => hasCommand(frames, 0x15)),
		]);
		await guest.tap.waitFor((frames) => hasCommand(frames, 0xfd)); // token

		const token = guest.tap.framesWithCommand(0xfd)[0].subarray(3).toString("utf8");
		expect(token).toMatch(/^[0-9a-f]{32}$/);

		// the guest drops; the room survives with both players
		guest.ws.close();
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(YGOProRoomList.findByName("room1")?.players).toHaveLength(2);

		// a fresh anonymous WebSocket reconnects with the token
		const rejoined = await connectWs(port);
		rejoined.ws.send(buildReconnectFrame(token));
		await rejoined.tap.waitFor((frames) => hasCommand(frames, 0x15)); // DUEL_START re-sync
		await rejoined.tap.waitFor((frames) => hasCommand(frames, 0x09)); // DECK_COUNT re-sync
		await rejoined.tap.waitFor((frames) => hasCommand(frames, 0x03)); // SELECT_HAND re-sync

		// success ack, then a rotated token different from the consumed one
		const fdFrames = rejoined.tap.framesWithCommand(0xfd);
		expect(fdFrames[0]).toEqual(Buffer.from([0x02, 0x00, 0xfd, 0x00])); // ack success
		const rotated = fdFrames[fdFrames.length - 1].subarray(3).toString("utf8");
		expect(rotated).toMatch(/^[0-9a-f]{32}$/);
		expect(rotated).not.toBe(token);

		expect(YGOProRoomList.findByName("room1")?.players).toHaveLength(2);
		host.ws.close();
		rejoined.ws.close();
	});

	it("rejects an unknown reconnect token with a failure ack and closes the connection", async () => {
		const port = await waitForListening();
		const { ws, tap } = await connectWs(port);

		// register the close waiter before sending: the server terminates the
		// socket synchronously after the failure ack
		const closed = waitForCloseOn(ws);
		ws.send(buildReconnectFrame("deadbeef"));
		await tap.waitFor((frames) => hasCommand(frames, 0xfd));
		expect(tap.framesWithCommand(0xfd)[0]).toEqual(Buffer.from([0x02, 0x00, 0xfd, 0x01]));
		await closed;
	});

	it("terminates a client that never answers heartbeat pings while a responsive client stays connected", async () => {
		const port = await waitForListening();
		const responsive = await connectWs(port);

		// zombie: raw TCP socket that completes the WS handshake but never pongs
		const zombie = await new Promise<net.Socket>((resolve, reject) => {
			const socket = net.connect(port, "127.0.0.1");
			socket.on("error", () => {
				// expected once the server terminates the zombie
			});
			socket.on("connect", () => {
				const key = randomBytes(16).toString("base64");
				socket.write(
					`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
				);
			});
			const handshakeTimer = setTimeout(() => {
				reject(new Error("zombie handshake timed out"));
			}, 5000);
			socket.on("data", (chunk: Buffer) => {
				if (chunk.toString("utf8").includes("101")) {
					clearTimeout(handshakeTimer);
					resolve(socket); // handshake done; pings from now on are ignored
				}
			});
		});

		// two sweeps with isAlive === false terminate the zombie
		await waitForCloseOnRaw(zombie, 3000);
		zombie.destroy();

		// the responsive client survives the same sweeps and is still functional
		expect(responsive.ws.readyState).toBe(WebSocket.OPEN);
		responsive.ws.send(buildFrame(0xff, Buffer.from([0x42])));
		await responsive.tap.waitFor((frames) => hasCommand(frames, 0xfe));
		responsive.ws.close();
	});
});
