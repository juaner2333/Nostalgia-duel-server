import { randomUUID } from "crypto";
import { EventEmitter } from "events";

import { YGOProRockPaperScissorState } from "./YGOProRockPaperScissorState";
import { YGOProChoosingOrderState } from "./YGOProChoosingOrderState";
import { YGOProDuelingState } from "./YGOProDuelingState";
import { YGOProSideDeckingState } from "./YGOProSideDeckingState";

import { YGOProClient } from "../../../client/domain/YGOProClient";
import { YGOProRoom } from "../YGOProRoom";
import { Team } from "@shared/room/Team";
import { ClientMessage } from "@shared/messages/MessageProcessor";
import { ISocket, SocketTransport } from "@shared/socket/domain/ISocket";
import { Deck } from "@shared/deck/domain/Deck";
import { Logger } from "@shared/logger/domain/Logger";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { YGOProRoomMother } from "@test-support/mothers/room/YGOProRoomMother";

/** ISocket whose lifecycle mirrors the TCP adapter (destroy detaches first). */
class StubSocket implements ISocket {
	id = randomUUID();
	roomId?: number;
	resolvedUserId?: string;
	readonly transport: SocketTransport;
	remoteAddress: string | undefined;
	closed = false;
	readonly sends: Buffer[] = [];
	removed = false;
	destroyed = false;
	private closeCallback?: () => void;

	constructor(remoteAddress = "127.0.0.1", transport: SocketTransport = "tcp") {
		this.remoteAddress = remoteAddress;
		this.transport = transport;
	}

	send(message: Buffer): void {
		this.sends.push(message);
	}

	onMessage(_callback: (message: Buffer) => void): void {
		// room-message routing is not needed for this stub
	}

	onClose(callback: () => void): void {
		this.closeCallback = callback;
	}

	close(): void {
		this.closed = true;
		this.closeCallback?.();
	}

	destroy(): void {
		this.removeAllListeners();
		this.destroyed = true;
		this.closed = true;
	}

	removeAllListeners(): void {
		this.removed = true;
		this.closeCallback = undefined;
	}

	commands(): number[] {
		return this.sends.map((frame) => frame[2]);
	}

	texts(): string[] {
		return this.sends.map((frame) => frame.toString());
	}
}

const makeLogger = (): jest.Mocked<Logger> =>
	({
		child: jest.fn().mockReturnThis(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		debug: jest.fn(),
	}) as unknown as jest.Mocked<Logger>;

/** A JOIN message whose previousMessage carries the PLAYER_INFO name (40 bytes UTF-16LE). */
const joinMessageFor = (name: string): ClientMessage => {
	const nameBuf = Buffer.alloc(40);
	for (let i = 0; i < name.length; i += 1) {
		nameBuf.writeUInt16LE(name.charCodeAt(i), i * 2);
	}
	return {
		data: Buffer.alloc(48),
		previousMessage: nameBuf,
	} as unknown as ClientMessage;
};

const DUEL_START_COMMAND = 0x15;

const createRoomWithPlayers = (): {
	room: YGOProRoom;
	jaden: YGOProClient;
	chazz: YGOProClient;
	jadenSocket: StubSocket;
	chazzSocket: StubSocket;
} => {
	const room = YGOProRoomMother.create();
	const jadenSocket = new StubSocket();
	const jaden = new YGOProClient({
		name: "Jaden",
		socket: jadenSocket,
		logger: new LoggerMock(),
		position: 0,
		host: true,
		id: null,
		team: Team.PLAYER,
		room,
	});
	room.addPlayerUnsafe(jaden);

	const chazzSocket = new StubSocket();
	const chazz = new YGOProClient({
		name: "Chazz",
		socket: chazzSocket,
		logger: new LoggerMock(),
		position: 1,
		host: false,
		id: null,
		team: Team.OPPONENT,
		room,
	});
	room.addPlayerUnsafe(chazz);

	return { room, jaden, chazz, jadenSocket, chazzSocket };
};

const commandsOf = (client: YGOProClient): number[] => (client.socket as StubSocket).commands();
const textsOf = (client: YGOProClient): string[] => (client.socket as StubSocket).texts();

// ---------------------------------------------------------------------------
// Rock-paper-scissors
// ---------------------------------------------------------------------------
describe("YGOProRockPaperScissorState.handleJoin — anonymous TCP takeover", () => {
	it("takes over the still-open seat of a same-IP TCP player and re-sends the phase prompt", () => {
		const { room, jaden, jadenSocket } = createRoomWithPlayers();
		jaden.captain();
		const emitter = new EventEmitter();
		new YGOProRockPaperScissorState(emitter, makeLogger());
		const newSocket = new StubSocket(); // same source IP as the original

		emitter.emit("JOIN", joinMessageFor("Jaden"), room, newSocket);

		expect(jadenSocket.destroyed).toBe(true);
		expect(jaden.socket).toBe(newSocket);
		expect(jaden.isReconnecting).toBe(true);
		// fixed RPS re-sync: DUEL_START + DECK_COUNT + SELECT_HAND (captain, not chosen)
		expect(newSocket.texts()).toContain("duel-start");
		expect(newSocket.commands()).toContain(0x09); // DECK_COUNT (real frame)
		expect(newSocket.texts()).toContain("select-hand");
		expect(room.players).toHaveLength(2);
		expect(room.spectators).toHaveLength(0);
	});

	it("takes over the seat even when the TCP player reconnects from a different source IP", () => {
		const { room, jaden, jadenSocket, chazzSocket } = createRoomWithPlayers();
		jaden.captain();
		const emitter = new EventEmitter();
		new YGOProRockPaperScissorState(emitter, makeLogger());
		const crossIpSocket = new StubSocket("203.0.113.9");

		emitter.emit("JOIN", joinMessageFor("Jaden"), room, crossIpSocket);

		expect(jadenSocket.destroyed).toBe(true);
		expect(jaden.socket).toBe(crossIpSocket);
		expect(chazzSocket.destroyed).toBe(false);
		expect(jaden.isReconnecting).toBe(true);
		expect(crossIpSocket.texts()).toContain("duel-start");
		expect(crossIpSocket.commands()).toContain(0x09); // DECK_COUNT (real frame)
		expect(crossIpSocket.texts()).toContain("select-hand");
		expect(room.players.map((p) => p.name)).toEqual(["Jaden", "Chazz"]);
		expect(room.spectators).toHaveLength(0);
	});

	it("logs a structured takeover judgement with room identity and socket ids", () => {
		const { room, jaden } = createRoomWithPlayers();
		const logger = makeLogger();
		const emitter = new EventEmitter();
		new YGOProRockPaperScissorState(emitter, logger);
		const previousSocketId = jaden.socket.id;
		const newSocket = new StubSocket();

		emitter.emit("JOIN", joinMessageFor("Jaden"), room, newSocket);

		expect(logger.info).toHaveBeenCalledWith("reconnect_judgement", {
			result: "takeover",
			roomId: room.id,
			formatId: "1109",
			externalRoomId: expect.any(String),
			state: "waiting",
			socketId: newSocket.id,
			socketTransport: "tcp",
			previousSocketId,
			previousSocketTransport: "tcp",
			name: "Jaden",
			roomPlayers: ["Jaden", "Chazz"],
		});
	});

	it("logs a structured rejection judgement with a stable reason and never token/payload fields", () => {
		const { room } = createRoomWithPlayers();
		const logger = makeLogger();
		const emitter = new EventEmitter();
		new YGOProRockPaperScissorState(emitter, logger);
		const websocketJoin = new StubSocket("203.0.113.9", "websocket");

		emitter.emit("JOIN", joinMessageFor("Jaden"), room, websocketJoin);

		expect(logger.info).toHaveBeenCalledWith("reconnect_judgement", {
			result: "rejected",
			reason: "transport_mismatch",
			roomId: room.id,
			formatId: "1109",
			externalRoomId: expect.any(String),
			state: "waiting",
			socketId: websocketJoin.id,
			socketTransport: "websocket",
			previousSocketId: undefined,
			previousSocketTransport: undefined,
			name: "Jaden",
			roomPlayers: ["Jaden", "Chazz"],
		});

		// no judgement log may carry a token, full wire payload or deck hex
		const contexts = (logger.info as jest.Mock).mock.calls
			.filter(([message]: [unknown]) => message === "reconnect_judgement")
			.map(([, context]: [unknown, Record<string, unknown>]) => context);
		expect(contexts.length).toBeGreaterThan(0);
		for (const context of contexts) {
			expect(context).not.toHaveProperty("token");
			expect(context).not.toHaveProperty("payload");
			expect(context).not.toHaveProperty("deck");
			expect(context).not.toHaveProperty("playerInfo");
			expect(context).not.toHaveProperty("joinGame");
		}
	});
});

// ---------------------------------------------------------------------------
// Choosing order
// ---------------------------------------------------------------------------
describe("YGOProChoosingOrderState.handleJoin — anonymous TCP takeover", () => {
	it("re-sends the turn-choice prompt when the reconnecting player is the chooser", () => {
		const { room, jaden, jadenSocket } = createRoomWithPlayers();
		room.setClientWhoChoosesTurn(jaden);
		const emitter = new EventEmitter();
		new YGOProChoosingOrderState(emitter, makeLogger());
		const newSocket = new StubSocket();

		emitter.emit("JOIN", joinMessageFor("Jaden"), room, newSocket);

		expect(jadenSocket.destroyed).toBe(true);
		expect(jaden.socket).toBe(newSocket);
		expect(jaden.isReconnecting).toBe(true);
		expect(newSocket.texts()).toContain("duel-start");
		expect(newSocket.commands()).toContain(0x09); // DECK_COUNT (real frame)
		expect(newSocket.texts()).toContain("select-tp");
	});

	it("takes over the seat and re-sends turn-choice prompt when reconnecting from a different source IP", () => {
		const { room, jaden, jadenSocket } = createRoomWithPlayers();
		room.setClientWhoChoosesTurn(jaden);
		const emitter = new EventEmitter();
		new YGOProChoosingOrderState(emitter, makeLogger());
		const crossIpSocket = new StubSocket("198.51.100.7");

		emitter.emit("JOIN", joinMessageFor("Jaden"), room, crossIpSocket);

		expect(jadenSocket.destroyed).toBe(true);
		expect(jaden.socket).toBe(crossIpSocket);
		expect(jaden.isReconnecting).toBe(true);
		expect(room.players).toHaveLength(2);
		expect(room.spectators).toHaveLength(0);
		expect(crossIpSocket.texts()).toContain("duel-start");
		expect(crossIpSocket.commands()).toContain(0x09); // DECK_COUNT (real frame)
		expect(crossIpSocket.texts()).toContain("select-tp");
	});
});

// ---------------------------------------------------------------------------
// Dueling
// ---------------------------------------------------------------------------
describe("YGOProDuelingState.handleJoin — anonymous TCP takeover", () => {
	const makeOcgCore = () => ({
		sendStartMessageForReconnect: jest.fn(),
		sendTurnMessages: jest.fn(),
		sendPhaseMessage: jest.fn(),
		sendRequestFieldMessage: jest.fn().mockResolvedValue(undefined),
		sendRefreshZonesMessages: jest.fn().mockResolvedValue(undefined),
		sendDeckReversedAndTopMessages: jest.fn().mockResolvedValue(undefined),
		sendReconnectTimeLimitAndResponseState: jest.fn().mockResolvedValue(undefined),
	});

	const buildState = (ocgCore: object, room: YGOProRoom) => {
		const state = Object.create(YGOProDuelingState.prototype) as {
			logger: LoggerMock;
			ocgCore: object;
			room: YGOProRoom;
			handleJoin(message: ClientMessage, room: YGOProRoom, socket: ISocket): void;
			handleUpdateDeck(
				message: ClientMessage,
				room: YGOProRoom,
				player: YGOProClient,
			): Promise<void>;
		};
		state.logger = makeLogger();
		state.ocgCore = ocgCore;
		state.room = room;
		return state;
	};

	it("takes over the still-open seat of a same-IP TCP player", () => {
		const { room, jaden, jadenSocket } = createRoomWithPlayers();
		const state = buildState(makeOcgCore(), room);
		const newSocket = new StubSocket();

		state.handleJoin(joinMessageFor("Jaden"), room, newSocket);

		expect(jadenSocket.destroyed).toBe(true);
		expect(jaden.socket).toBe(newSocket);
		expect(jaden.isReconnecting).toBe(true);
		expect(room.players).toHaveLength(2);
		expect(room.spectators).toHaveLength(0);
	});

	it("takes over the seat when reconnecting from a different source IP", () => {
		const { room, jaden, jadenSocket } = createRoomWithPlayers();
		const state = buildState(makeOcgCore(), room);
		const crossIpSocket = new StubSocket("192.0.2.55");

		state.handleJoin(joinMessageFor("Jaden"), room, crossIpSocket);

		expect(jadenSocket.destroyed).toBe(true);
		expect(jaden.socket).toBe(crossIpSocket);
		expect(jaden.isReconnecting).toBe(true);
		expect(room.players).toHaveLength(2);
		expect(room.spectators).toHaveLength(0);
	});

	it("re-submitting the deck after a takeover re-syncs the board and clears the reconnect flag", async () => {
		const { room, jaden, jadenSocket } = createRoomWithPlayers();
		const ocgCore = makeOcgCore();
		const state = buildState(ocgCore, room);
		state.handleJoin(joinMessageFor("Jaden"), room, new StubSocket());
		expect(jaden.isReconnecting).toBe(true);

		jaden.setDeck({ isSideDeckValid: () => true } as unknown as Deck);
		const payload = Buffer.alloc(8);
		payload.writeUInt32LE(0, 0); // main count
		payload.writeUInt32LE(0, 4); // side count
		const message = { data: payload } as ClientMessage;

		await state.handleUpdateDeck(message, room, jaden);

		// full board re-sync ran over the reconnected socket
		expect(ocgCore.sendStartMessageForReconnect).toHaveBeenCalledWith(jaden);
		expect(ocgCore.sendTurnMessages).toHaveBeenCalledWith(jaden);
		expect(ocgCore.sendRequestFieldMessage).toHaveBeenCalledWith(jaden);
		expect(jaden.isReconnecting).toBe(false);
		// the new socket (not the destroyed old one) received the DUEL_START sync
		expect(commandsOf(jaden)).toContain(DUEL_START_COMMAND);
		expect(jadenSocket.destroyed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Side decking
// ---------------------------------------------------------------------------
describe("YGOProSideDeckingState.handleJoin — anonymous TCP takeover", () => {
	jest.useFakeTimers();

	let state: YGOProSideDeckingState | null = null;

	afterEach(() => {
		state?.removeAllListener();
		state = null;
	});

	it("re-sends the side-deck prompt to a reconnecting player who has not submitted", () => {
		const { room, jaden, jadenSocket } = createRoomWithPlayers();
		const emitter = new EventEmitter();
		state = new YGOProSideDeckingState(emitter, makeLogger(), {} as never, {} as never, room);
		const newSocket = new StubSocket();

		emitter.emit("JOIN", joinMessageFor("Jaden"), room, newSocket);

		expect(jadenSocket.destroyed).toBe(true);
		expect(jaden.socket).toBe(newSocket);
		// the side-deck state finishes the re-sync synchronously (no board resubmission)
		expect(jaden.isReconnecting).toBe(false);
		expect(newSocket.texts()).toContain("duel-start");
		expect(newSocket.texts()).toContain("change-side");
	});

	it("takes over the seat and re-sends side-deck prompt when reconnecting from a different source IP", () => {
		const { room, jaden, jadenSocket } = createRoomWithPlayers();
		const emitter = new EventEmitter();
		state = new YGOProSideDeckingState(emitter, makeLogger(), {} as never, {} as never, room);
		const crossIpSocket = new StubSocket("203.0.113.77");

		emitter.emit("JOIN", joinMessageFor("Jaden"), room, crossIpSocket);

		expect(jadenSocket.destroyed).toBe(true);
		expect(jaden.socket).toBe(crossIpSocket);
		expect(jaden.isReconnecting).toBe(false);
		expect(crossIpSocket.texts()).toContain("duel-start");
		expect(crossIpSocket.texts()).toContain("change-side");
		expect(room.players).toHaveLength(2);
		expect(room.spectators).toHaveLength(0);
	});
});
