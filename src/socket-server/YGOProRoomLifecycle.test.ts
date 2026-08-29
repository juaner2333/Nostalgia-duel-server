/**
 * Two-socket room lifecycle contract over real TCP.
 *
 * Drives the full supported room flow with two test-side sockets against a real
 * YGOProServer on a temporary port: create/join, deck validation, both ready,
 * duel start, chat/emote, RPS, choosing order, disconnect handling, name-path
 * reconnect, and (with the engine boundary stubbed) duel end + replay delivery.
 *
 * The ocgcore WASM engine and the sql.js card database live outside the repo
 * (resources/ is untracked) and cannot boot inside jest worker threads, so the
 * two resource-touching ports — OCGCore and CardYGOProRepository — are replaced
 * at the module boundary. Everything between them (TCP framing, join strategies,
 * room state machine, deck validation chain, message repository) is real.
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

// Engine boundary: a deterministic in-memory ocgcore. init() returns a real
// DuelRecord (so replays serialize for real) and the duel simply waits for a
// surrender instead of running game logic.
jest.mock("@ygopro/ocgcore-worker/ocgcore", () => {
	const { DuelRecord } = jest.requireActual("@ygopro/room/domain/DuelRecord");
	const { GameMessageMiddleware } = jest.requireActual("@ygopro/middleware/GameMessageMiddleware");
	const YGOProDeck = jest.requireActual("ygopro-deck-encode").default;
	const { generateSeed } = jest.requireActual("@ygopro/utils/generate-seed");

	class StubOCGCore {
		private readonly middleware = new GameMessageMiddleware();

		constructor(
			private readonly room: any,
			_logger: any,
		) {
			// engine bound directly to its room; no worker startup needed
		}

		get messageMiddleware() {
			return this.middleware;
		}

		async init() {
			const players = [...this.room.players]
				.sort((a: any, b: any) => a.position - b.position)
				.map((client: any) => ({
					name: client.name,
					deck: new YGOProDeck({
						main: client.deck.main.map((card: any) => Number(card.code)),
						side: client.deck.side.map((card: any) => Number(card.code)),
					}),
				}));
			return new DuelRecord(generateSeed(), players, this.room.isPositionSwapped);
		}

		// the stub duel never requests responses or advances turns: it waits for
		// a surrender instead of running game logic
		resetResponseRequestState(): void {
			// no-op by design
		}
		refreshZones(_query: unknown): void {
			// no-op by design
		}
		advance(): void {
			// no-op by design
		}
		hasOcgcore(): boolean {
			return true;
		}
		dispose(): void {
			// no-op by design
		}

		async queryFieldCount(query: { location: number }): Promise<number> {
			return query.location === 0x01 ? 40 : 0; // LOCATION_DECK vs anything else
		}

		getPlayersAtIngamePosition(position: number) {
			return [...this.room.players].filter((client: any) => client.position === position);
		}

		getIngamePosition(client: any): number {
			return client.position & 1;
		}

		toIngamePosition(position: number): number {
			return position & 1;
		}

		getSideTeam(side: number): number {
			return side;
		}
	}

	return { OCGCore: StubOCGCore };
});

import net from "net";

import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { DefaultJoinStrategy } from "@ygopro/room/application/join-strategies/DefaultJoinStrategy";
import { JoinStrategyRegistry } from "@ygopro/room/application/join-strategies/JoinStrategyRegistry";
import { NostalgiaJoinStrategy } from "@ygopro/room/application/join-strategies/NostalgiaJoinStrategy";
import YGOProRoomList from "@ygopro/room/infrastructure/YGOProRoomList";
import { FinalizeYGOProRoom } from "@ygopro/room/application/FinalizeYGOProRoom";
import {
	ErrorMessageType,
	NetPlayerType,
	PlayerChangeState,
	YGOProStocChat,
	YGOProStocErrorMsg,
	YGOProStocHandResult,
	YGOProStocHsPlayerChange,
} from "ygopro-msg-encode";

import { YGOProClient } from "@ygopro/client/domain/YGOProClient";
import { YGOProServer } from "./YGOProServer";

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

const buildPlayerInfoFrame = (name: string): Buffer => buildFrame(0x10, encodeUtf16LE(name, 20));

const buildJoinGameFrame = (pass: string): Buffer => buildJoinGameFrameWithVersion(pass, 0x1362);

const buildJoinGameFrameWithVersion = (pass: string, version: number): Buffer => {
	const payload = Buffer.alloc(48);
	payload.writeUInt16LE(version, 0);
	payload.writeUInt16LE(0xcccc, 2);
	payload.writeUInt32LE(42, 4);
	encodeUtf16LE(pass, 20).copy(payload, 8);
	return buildFrame(0x12, payload);
};

const buildUpdateDeckFrame = (main: number[], side: number[] = []): Buffer => {
	const payload = Buffer.alloc(8 + (main.length + side.length) * 4);
	payload.writeUInt32LE(main.length, 0);
	payload.writeUInt32LE(side.length, 4);
	let offset = 8;
	for (const code of [...main, ...side]) {
		payload.writeUInt32LE(code, offset);
		offset += 4;
	}
	return buildFrame(0x02, payload);
};

const buildChatFrame = (text: string): Buffer =>
	buildFrame(0x16, encodeUtf16LE(text, Math.max(1, text.length)));

const buildEmoteFrame = (emoteId: string): Buffer => buildFrame(0xfc, Buffer.from(emoteId, "utf8"));

const buildRpsChoiceFrame = (res: number): Buffer => buildFrame(0x03, Buffer.from([res]));

const buildTurnChoiceFrame = (res: number): Buffer => buildFrame(0x04, Buffer.from([res]));

// TRY_START (37) and SURRENDER (20) carry no payload.
const buildTryStartFrame = (): Buffer => buildFrame(37, Buffer.alloc(0));
const buildSurrenderFrame = (): Buffer => buildFrame(20, Buffer.alloc(0));

const VALID_MAIN_DECK = (): number[] => Array<number>(40).fill(89631139);
const UNKNOWN_CARD_CODE = 99999999;

// [size=9][0x02 error][0x04 VER_ERROR][code 3B][version 4962 LE]
const VERSION_ERROR_FRAME_HEX = "0900020400000062130000";

// ---------- socket-side helpers ----------

const splitFrames = (data: Buffer): Buffer[] => {
	const frames: Buffer[] = [];
	let offset = 0;
	while (offset + 2 <= data.length) {
		const frameLength = data.readUInt16LE(offset);
		if (frameLength === 0) {
			break;
		}
		const frameEnd = offset + 2 + frameLength;
		if (frameEnd > data.length) {
			break;
		}
		frames.push(data.subarray(offset, frameEnd));
		offset = frameEnd;
	}
	return frames;
};

const commandOf = (frame: Buffer): number => frame[2];

/** Continuously records every complete frame arriving on a client socket. */
class FrameTap {
	private buffer: Buffer = Buffer.alloc(0);
	private frames: Buffer[] = [];

	constructor(socket: net.Socket) {
		socket.on("data", (chunk: Buffer) => {
			this.buffer = Buffer.concat([this.buffer, chunk]);
			this.frames = splitFrames(this.buffer);
		});
		socket.on("error", () => {
			// socket errors surface via close; assertions never depend on them
		});
	}

	get all(): Buffer[] {
		return this.frames;
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

// ---------- test ----------

describe("YGOProRoom · two-socket lifecycle contract", () => {
	let server: YGOProServer;

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
				// late connect errors surface via close; never asserted here
			});
			socket.on("connect", () => resolve(socket));
		});

	/** Connects from a different loopback source address (cross-IP attempt). */
	const connectFromAddress = (port: number, localAddress: string): Promise<net.Socket> =>
		new Promise((resolve) => {
			const socket = net.connect({ port, host: "127.0.0.1", localAddress });
			socket.on("error", () => {
				// late connect errors surface via close; never asserted here
			});
			socket.on("connect", () => resolve(socket));
		});

	/** Connects and joins `roomName`, returning the socket and its frame tap. */
	const joinRoom = async (
		port: number,
		name: string,
		roomName: string,
	): Promise<{ socket: net.Socket; tap: FrameTap }> => {
		const socket = await connect(port);
		const tap = new FrameTap(socket);
		socket.write(buildPlayerInfoFrame(name));
		socket.write(buildJoinGameFrame(roomName));
		await tap.waitFor(
			(frames) =>
				frames.some((frame) => commandOf(frame) === 0x12) &&
				frames.some((frame) => commandOf(frame) === 0x13),
		);
		return { socket, tap };
	};

	const submitDeck = async (
		socket: net.Socket,
		tap: FrameTap,
		main: number[],
	): Promise<Buffer[]> => {
		socket.write(buildUpdateDeckFrame(main));
		return tap.waitFor((frames) => frames.some((frame) => commandOf(frame) === 0x21));
	};

	const runRps = async (
		socketA: net.Socket,
		tapA: FrameTap,
		socketB: net.Socket,
		tapB: FrameTap,
	): Promise<void> => {
		socketA.write(buildRpsChoiceFrame(1)); // ROCK
		socketB.write(buildRpsChoiceFrame(3)); // PAPER
		await Promise.all([
			tapA.waitFor((frames) => frames.some((frame) => commandOf(frame) === 0x05)),
			tapB.waitFor((frames) => frames.some((frame) => commandOf(frame) === 0x05)),
		]);
	};

	const createRoomAtPhase = async (
		port: number,
		phase: "waiting" | "rps" | "choosing-order" | "dueling" | "side-decking",
		roomName = "1109#1001",
	): Promise<{
		host: { socket: net.Socket; tap: FrameTap };
		guest: { socket: net.Socket; tap: FrameTap };
	}> => {
		const host = await joinRoom(port, "Jaden", roomName);
		const guest = await joinRoom(port, "Chazz", roomName);
		if (phase === "waiting") {
			return { host, guest };
		}

		await submitDeck(host.socket, host.tap, VALID_MAIN_DECK());
		await submitDeck(guest.socket, guest.tap, VALID_MAIN_DECK());
		host.socket.write(buildTryStartFrame());
		await Promise.all([
			host.tap.waitFor((frames) => hasCommand(frames, 0x15)),
			guest.tap.waitFor((frames) => hasCommand(frames, 0x15)),
		]);
		if (phase === "rps") {
			return { host, guest };
		}

		await runRps(host.socket, host.tap, guest.socket, guest.tap);
		await host.tap.waitFor((frames) => hasCommand(frames, 0x04));
		if (phase === "choosing-order") {
			return { host, guest };
		}

		host.socket.write(buildTurnChoiceFrame(1));
		await Promise.all([
			host.tap.waitFor((frames) => hasCommand(frames, 0x01)),
			guest.tap.waitFor((frames) => hasCommand(frames, 0x01)),
		]);
		if (phase === "dueling") {
			return { host, guest };
		}

		guest.socket.write(buildSurrenderFrame());
		await Promise.all([
			host.tap.waitFor((frames) => hasCommand(frames, 0x07)),
			guest.tap.waitFor((frames) => hasCommand(frames, 0x07)),
		]);
		return { host, guest };
	};

	beforeEach(() => {
		JoinStrategyRegistry.setStrategies([
			new NostalgiaJoinStrategy({ getBanListHash: () => 1109 }),
			new DefaultJoinStrategy(),
		]);
		server = new YGOProServer(new LoggerMock());
		server.initialize(0);
	});

	afterEach(() => {
		for (const room of [...YGOProRoomList.getRooms()]) {
			// Run the canonical teardown: it cancels any pending reconnect-grace
			// timer AND detaches the state machine (side-decking intervals), so no
			// timer keeps the jest event loop alive after the suite ends.
			FinalizeYGOProRoom.run(room);
		}
		JoinStrategyRegistry.reset();
		server.close();
	});

	it("creates and joins a room with two players", async () => {
		const { port } = await waitForListening();
		const host = await joinRoom(port, "Jaden", "1109#1001");
		const guest = await joinRoom(port, "Chazz", "1109#1001");

		// both see each other's PLAYER_ENTER
		const hostEnter = host.tap
			.framesWithCommand(0x20)
			.map((frame) => frame.subarray(3).toString("utf16le").split("\0")[0]);
		expect(hostEnter).toContain("Chazz");
		const guestEnter = guest.tap
			.framesWithCommand(0x20)
			.map((frame) => frame.subarray(3).toString("utf16le").split("\0")[0]);
		expect(guestEnter).toEqual(expect.arrayContaining(["Jaden", "Chazz"]));

		const room = YGOProRoomList.findByName("1109#1001");
		expect(room?.players).toHaveLength(2);

		host.socket.destroy();
		guest.socket.destroy();
	});

	it.each([
		"waiting",
		"rps",
		"choosing-order",
		"dueling",
		"side-decking",
	] as const)("admits a third client as a spectator during %s without changing player seats", async (phase) => {
		const { port } = await waitForListening();
		const { host, guest } = await createRoomAtPhase(port, phase);

		const spectator = await joinRoom(port, `Observer-${phase}`, "1109#1001");
		const room = YGOProRoomList.findByAdmissionKey("1109#1001");

		expect(room?.players).toHaveLength(2);
		expect(room?.spectators).toHaveLength(1);
		expect(room?.players.map((player) => player.name)).toEqual(
			expect.arrayContaining(["Jaden", "Chazz"]),
		);

		host.socket.destroy();
		guest.socket.destroy();
		spectator.socket.destroy();
	});

	it.each([
		"rps",
		"dueling",
	] as const)("rejects an unsupported 0x1360 join during %s with only the version frames and no room side effects", async (phase) => {
		const { port } = await waitForListening();
		const { host, guest } = await createRoomAtPhase(port, phase);

		const room = YGOProRoomList.findByAdmissionKey("1109#1001");
		const playersBefore = room?.players.map((player) => player.name);
		const spectatorsBefore = room?.spectators.length;

		const intruder = await connect(port);
		const tap = new FrameTap(intruder);
		const closed = new Promise<void>((resolve) => intruder.on("close", () => resolve()));
		intruder.write(buildPlayerInfoFrame("Syrus"));
		intruder.write(buildJoinGameFrameWithVersion("1109#1001", 0x1360));
		await Promise.all([tap.waitFor((frames) => frames.length >= 2), closed]);

		// exactly the VersionError frame followed by the upgrade hint — nothing else
		expect(tap.commands()).toEqual([0x02, 0x19]);
		expect(tap.commands()).not.toContain(0x12); // no join-game response
		expect(tap.commands()).not.toContain(0x15); // no duel start / re-sync / history
		expect(tap.commands()).not.toContain(0x01); // no game messages

		expect(tap.all[0].toString("hex")).toBe(VERSION_ERROR_FRAME_HEX);
		const hint = new YGOProStocChat().fromFullPayload(tap.all[1]);
		expect(hint.player_type).toBe(0x09);
		expect(hint.msg).toContain("0x1362");
		expect(hint.msg).toContain("升级");

		// no observer was added and no seat changed
		expect(room?.players.map((player) => player.name)).toEqual(playersBefore);
		expect(room?.spectators.length).toBe(spectatorsBefore);

		host.socket.destroy();
		guest.socket.destroy();
		intruder.destroy();
	});

	it("does not take over an active player's seat via name reconnect for an unsupported 0x1360 join", async () => {
		const { port } = await waitForListening();
		const { host, guest } = await createRoomAtPhase(port, "dueling");

		// Drop the guest so the closed-socket name-reconnect guards would match a
		// re-joining "Chazz" if the dueling phase ever saw the JOIN.
		guest.socket.destroy();
		await new Promise((resolve) => setTimeout(resolve, 150));

		const room = YGOProRoomList.findByAdmissionKey("1109#1001");
		const playersBefore = room?.players.map((player) => player.name);

		const intruder = await connect(port);
		const tap = new FrameTap(intruder);
		const closed = new Promise<void>((resolve) => intruder.on("close", () => resolve()));
		intruder.write(buildPlayerInfoFrame("Chazz"));
		intruder.write(buildJoinGameFrameWithVersion("1109#1001", 0x1360));
		await Promise.all([tap.waitFor((frames) => frames.length >= 2), closed]);

		// only version frames; the reconnect path never emits join/sync messages
		expect(tap.commands()).toEqual([0x02, 0x19]);
		expect(tap.commands()).not.toContain(0x12);
		expect(tap.commands()).not.toContain(0x13);
		expect(tap.commands()).not.toContain(0x15);

		expect(tap.all[0].toString("hex")).toBe(VERSION_ERROR_FRAME_HEX);
		const hint = new YGOProStocChat().fromFullPayload(tap.all[1]);
		expect(hint.msg).toContain("0x1362");

		// the guest keeps its seat; the intruder never took it over
		expect(room?.players.map((player) => player.name)).toEqual(playersBefore);
		expect(room?.players.find((player) => player.name === "Chazz")).toBeDefined();

		host.socket.destroy();
		intruder.destroy();
	});

	it("takes over an active player's seat via name reconnect for a 0x1361 join during dueling", async () => {
		const { port } = await waitForListening();
		const { host, guest } = await createRoomAtPhase(port, "dueling");

		guest.socket.destroy();
		await new Promise((resolve) => setTimeout(resolve, 150));

		const room = YGOProRoomList.findByAdmissionKey("1109#1001");

		const reconnectClient = await connect(port);
		const tap = new FrameTap(reconnectClient);
		reconnectClient.write(buildPlayerInfoFrame("Chazz"));
		reconnectClient.write(buildJoinGameFrameWithVersion("1109#1001", 0x1361));

		await tap.waitFor((frames) => hasCommand(frames, 0x12) && hasCommand(frames, 0x13));

		const chazzPlayer = room?.players.find((p) => p.name === "Chazz") as YGOProClient | undefined;
		expect(chazzPlayer).toBeDefined();
		expect(chazzPlayer?.protocolVersion).toBe(0x1361);

		host.socket.destroy();
		reconnectClient.destroy();
	});

	it("rejects an unknown card and broadcasts ready state to both players", async () => {
		const { port } = await waitForListening();
		const host = await joinRoom(port, "Jaden", "1109#1001");
		const guest = await joinRoom(port, "Chazz", "1109#1001");

		// unknown card -> DECKERROR, player stays not ready
		guest.socket.write(buildUpdateDeckFrame(Array<number>(40).fill(UNKNOWN_CARD_CODE)));
		await guest.tap.waitFor((frames) => hasCommand(frames, 0x02)); // ERROR_MSG
		const errorFrame = guest.tap.framesWithCommand(0x02)[0];
		const errorMsg = new YGOProStocErrorMsg().fromFullPayload(errorFrame);
		expect(errorMsg.msg).toBe(ErrorMessageType.DECKERROR);
		// encodeDeckErrorCode(CARD_UNKNOWN=0x4, code): (0x4 << 28) | 99999999
		expect(errorMsg.code).toBe(1173741823);

		// valid deck -> PLAYER_CHANGE(pos=1, READY) broadcast to both players
		await submitDeck(guest.socket, guest.tap, VALID_MAIN_DECK());
		await Promise.all([
			host.tap.waitFor((frames) =>
				frames.some((frame) => isPlayerChange(frame, 1, PlayerChangeState.READY)),
			),
			guest.tap.waitFor((frames) =>
				frames.some((frame) => isPlayerChange(frame, 1, PlayerChangeState.READY)),
			),
		]);

		// host ready -> PLAYER_CHANGE(pos=0, READY) broadcast to both players
		await submitDeck(host.socket, host.tap, VALID_MAIN_DECK());
		await Promise.all([
			host.tap.waitFor((frames) =>
				frames.some((frame) => isPlayerChange(frame, 0, PlayerChangeState.READY)),
			),
			guest.tap.waitFor((frames) =>
				frames.some((frame) => isPlayerChange(frame, 0, PlayerChangeState.READY)),
			),
		]);

		const room = YGOProRoomList.findByName("1109#1001");
		expect(room?.allPlayersReady).toBe(true);

		host.socket.destroy();
		guest.socket.destroy();
	});

	it("broadcasts chat and emotes between the two players", async () => {
		const { port } = await waitForListening();
		const host = await joinRoom(port, "Jaden", "1109#1001");
		const guest = await joinRoom(port, "Chazz", "1109#1001");

		guest.socket.write(buildChatFrame("gg"));
		await Promise.all([
			host.tap.waitFor((frames) => frames.some((frame) => commandOf(frame) === 0x19)),
			guest.tap.waitFor((frames) => frames.some((frame) => commandOf(frame) === 0x19)),
		]);
		const chatOnHost = new YGOProStocChat().fromFullPayload(host.tap.framesWithCommand(0x19)[0]);
		expect(chatOnHost.player_type).toBe(1); // guest seat
		expect(chatOnHost.msg).toBe("gg");

		host.socket.write(buildEmoteFrame("wave"));
		await Promise.all([
			host.tap.waitFor((frames) => frames.some((frame) => commandOf(frame) === 0xfc)),
			guest.tap.waitFor((frames) => frames.some((frame) => commandOf(frame) === 0xfc)),
		]);
		const emoteOnGuest = guest.tap.framesWithCommand(0xfc)[0];
		expect(emoteOnGuest[3]).toBe(0); // host seat
		expect(emoteOnGuest.subarray(4).toString("utf8")).toBe("wave");

		// same-player emote within the cooldown window is dropped, not broadcast
		host.socket.write(buildEmoteFrame("fire"));
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(host.tap.framesWithCommand(0xfc)).toHaveLength(1);
		expect(guest.tap.framesWithCommand(0xfc)).toHaveLength(1);

		host.socket.destroy();
		guest.socket.destroy();
	});

	it("starts the duel, resolves RPS and reaches choosing order", async () => {
		const { port } = await waitForListening();
		const host = await joinRoom(port, "Jaden", "1109#1001");
		const guest = await joinRoom(port, "Chazz", "1109#1001");

		await submitDeck(host.socket, host.tap, VALID_MAIN_DECK());
		await submitDeck(guest.socket, guest.tap, VALID_MAIN_DECK());

		// host starts the duel
		host.socket.write(buildTryStartFrame());
		await Promise.all([
			host.tap.waitFor((frames) => hasCommand(frames, 0x15)), // DUEL_START
			guest.tap.waitFor((frames) => hasCommand(frames, 0x15)),
		]);

		for (const [tap, expectedName] of [
			[host.tap, "Jaden"],
			[guest.tap, "Chazz"],
		] as const) {
			// deck counts for both teams
			expect(tap.framesWithCommand(0x09)).toHaveLength(1);
			// reconnection token: [0xfd][32 hex chars]
			const tokenFrame = tap.framesWithCommand(0xfd)[0];
			expect(tokenFrame).toBeDefined();
			expect(tokenFrame.subarray(3).toString("utf8")).toMatch(/^[0-9a-f]{32}$/);
			expect(expectedName).toBeTruthy();
			// both captains are asked for RPS
			expect(tap.framesWithCommand(0x03)).toHaveLength(1);
		}

		// RPS: host ROCK (1) vs guest PAPER (3) -> host wins per server rules
		await runRps(host.socket, host.tap, guest.socket, guest.tap);

		const hostHand = new YGOProStocHandResult().fromFullPayload(
			host.tap.framesWithCommand(0x05)[0],
		);
		expect([hostHand.res1, hostHand.res2]).toEqual([1, 3]);
		const guestHand = new YGOProStocHandResult().fromFullPayload(
			guest.tap.framesWithCommand(0x05)[0],
		);
		expect([guestHand.res1, guestHand.res2]).toEqual([3, 1]);

		// only the RPS winner chooses the turn order
		await host.tap.waitFor((frames) => hasCommand(frames, 0x04)); // SELECT_TP
		expect(guest.tap.framesWithCommand(0x04)).toHaveLength(0);

		expect(YGOProRoomList.findByName("1109#1001")).not.toBeNull();

		host.socket.destroy();
		guest.socket.destroy();
	});

	it("keeps the room alive when a player disconnects and re-admits them on rejoin", async () => {
		const { port } = await waitForListening();
		const host = await joinRoom(port, "Jaden", "1109#1001");
		const guest = await joinRoom(port, "Chazz", "1109#1001");

		await submitDeck(host.socket, host.tap, VALID_MAIN_DECK());
		await submitDeck(guest.socket, guest.tap, VALID_MAIN_DECK());
		host.socket.write(buildTryStartFrame());
		await Promise.all([
			host.tap.waitFor((frames) => hasCommand(frames, 0x15)),
			guest.tap.waitFor((frames) => hasCommand(frames, 0x15)),
		]);
		await runRps(host.socket, host.tap, guest.socket, guest.tap);
		await host.tap.waitFor((frames) => hasCommand(frames, 0x04));

		// guest drops mid-flow: the room must survive with both players listed
		guest.socket.destroy();
		await new Promise((resolve) => setTimeout(resolve, 150));

		const room = YGOProRoomList.findByName("1109#1001");
		expect(room).not.toBeNull();
		expect(room?.players).toHaveLength(2);
		expect(room?.players.map((player) => player.name)).toEqual(
			expect.arrayContaining(["Jaden", "Chazz"]),
		);

		// guest rejoins by re-sending the first packet (TCP name-path reconnect)
		const rejoined = await joinRoom(port, "Chazz", "1109#1001");
		await rejoined.tap.waitFor((frames) => hasCommand(frames, 0x15)); // DUEL_START re-sync
		expect(rejoined.tap.framesWithCommand(0x09)).toHaveLength(1); // DECK_COUNT re-sync

		expect(YGOProRoomList.findByName("1109#1001")?.players).toHaveLength(2);

		host.socket.destroy();
		rejoined.socket.destroy();
	});

	it("enters side decking after a surrender in the first MATCH game", async () => {
		const { port } = await waitForListening();
		const host = await joinRoom(port, "Jaden", "1109#1001");
		const guest = await joinRoom(port, "Chazz", "1109#1001");

		await submitDeck(host.socket, host.tap, VALID_MAIN_DECK());
		await submitDeck(guest.socket, guest.tap, VALID_MAIN_DECK());
		host.socket.write(buildTryStartFrame());
		await Promise.all([
			host.tap.waitFor((frames) => hasCommand(frames, 0x15)),
			guest.tap.waitFor((frames) => hasCommand(frames, 0x15)),
		]);
		await runRps(host.socket, host.tap, guest.socket, guest.tap);
		await host.tap.waitFor((frames) => hasCommand(frames, 0x04));

		// winner picks first; the room enters the dueling phase and both players
		// receive the MSG_START game message from the (stubbed) engine
		host.socket.write(buildTurnChoiceFrame(1));
		await Promise.all([
			host.tap.waitFor((frames) => hasCommand(frames, 0x01)), // STOC_GAME_MSG
			guest.tap.waitFor((frames) => hasCommand(frames, 0x01)),
		]);

		// The first result in a best-of-3 match enters side decking; it does not
		// finalize the room or close either connection.
		guest.socket.write(buildSurrenderFrame());
		await Promise.all([
			host.tap.waitFor((frames) => hasCommand(frames, 0x07)),
			guest.tap.waitFor((frames) => hasCommand(frames, 0x07)),
		]);

		const room = YGOProRoomList.findByAdmissionKey("1109#1001");
		expect(room?.isMatchFinished()).toBe(false);
		expect(room?.players).toHaveLength(2);

		host.socket.destroy();
		guest.socket.destroy();
	});

	it.each([
		"1103",
		"1109",
	] as const)("%s#1001: a cross-IP TCP connection takes over the original seat and closes the stale socket", async (formatId) => {
		const { port } = await waitForListening();
		const roomName = `${formatId}#1001`;
		const { host, guest } = await createRoomAtPhase(port, "dueling", roomName);
		const room = YGOProRoomList.findByAdmissionKey(roomName);
		expect(room?.players).toHaveLength(2);

		const oldGuestClosed = new Promise<void>((resolve) =>
			guest.socket.on("close", () => resolve()),
		);

		const crossIpSocket = await connectFromAddress(port, "127.0.0.2");
		const tap = new FrameTap(crossIpSocket);
		crossIpSocket.write(buildPlayerInfoFrame("Chazz"));
		crossIpSocket.write(buildJoinGameFrame(roomName));
		await tap.waitFor((frames) => hasCommand(frames, 0x12) && hasCommand(frames, 0x13));

		// the takeover actively closed the stale half-open connection
		await oldGuestClosed;

		// seat identity unchanged: same player names, same count, host intact
		expect(room?.players).toHaveLength(2);
		expect(room?.players.map((p) => p.name)).toEqual(expect.arrayContaining(["Jaden", "Chazz"]));
		expect(room?.players.find((p) => p.name === "Jaden")?.host).toBe(true);
		expect(room?.spectators).toHaveLength(0);

		host.socket.destroy();
		crossIpSocket.destroy();
	});

	it("retains the room after both players disconnect and restores a seat within the grace window", async () => {
		const { port } = await waitForListening();
		const { host, guest } = await createRoomAtPhase(port, "dueling");
		const room = YGOProRoomList.findByAdmissionKey("1109#1001");
		expect(room).not.toBeNull();
		room!.reconnectGraceMs = 400;

		// both players' connections close for real
		guest.socket.destroy();
		host.socket.destroy();
		await new Promise((resolve) => setTimeout(resolve, 100));

		// the room and both seats survive inside the grace window
		expect(YGOProRoomList.findByAdmissionKey("1109#1001")).toBe(room);
		expect(room?.players).toHaveLength(2);

		// one original player recovers by name before the window expires
		const rejoined = await joinRoom(port, "Jaden", "1109#1001");
		await rejoined.tap.waitFor((frames) => hasCommand(frames, 0x12) && hasCommand(frames, 0x13));

		// the takeover cancelled the pending teardown: the room survives past the
		// original window with the same seats
		await new Promise((resolve) => setTimeout(resolve, 600));
		expect(YGOProRoomList.findByAdmissionKey("1109#1001")).toBe(room);
		expect(room?.players).toHaveLength(2);
		expect(room?.players.map((p) => p.name)).toEqual(expect.arrayContaining(["Jaden", "Chazz"]));

		rejoined.socket.destroy();
	});

	it("removes the room after the grace window and lets the same identifier start a fresh room", async () => {
		const { port } = await waitForListening();
		const { host, guest } = await createRoomAtPhase(port, "dueling");
		const room = YGOProRoomList.findByAdmissionKey("1109#1001");
		expect(room).not.toBeNull();
		room!.reconnectGraceMs = 300;

		guest.socket.destroy();
		host.socket.destroy();
		// outlast the grace window: the unified teardown must run exactly once
		await new Promise((resolve) => setTimeout(resolve, 700));

		expect(YGOProRoomList.findByAdmissionKey("1109#1001")).toBeNull();

		// the same room identifier now creates a brand-new room — the old duel
		// state and reconnect eligibility are gone with the old room
		const joiner = await joinRoom(port, "Chazz", "1109#1001");
		const newRoom = YGOProRoomList.findByAdmissionKey("1109#1001");
		expect(newRoom).not.toBeNull();
		expect(newRoom).not.toBe(room);
		expect(newRoom?.players.map((p) => p.name)).toEqual(["Chazz"]);
		expect(newRoom?.duelState).toBe("waiting");

		joiner.socket.destroy();
	});
});

// ---------- small assertion helpers ----------

const hasCommand = (frames: Buffer[], command: number): boolean =>
	frames.some((frame) => commandOf(frame) === command);

const isPlayerChange = (frame: Buffer, position: number, state: number): boolean => {
	if (commandOf(frame) !== 0x21) {
		return false;
	}
	const message = new YGOProStocHsPlayerChange().fromFullPayload(frame);
	return message.playerPosition === position && message.playerState === state;
};
