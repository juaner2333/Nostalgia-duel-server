import { EventEmitter } from "stream";

import { Commands } from "@shared/messages/Commands";
import { ClientMessage } from "@shared/messages/MessageProcessor";
import { Logger } from "@shared/logger/domain/Logger";

import { YGOProClient } from "../../../client/domain/YGOProClient";
import { YGOProRoom } from "../YGOProRoom";
import {
	RANKED_READY_KICK_MESSAGE,
	RANKED_START_KICK_MESSAGE,
	YGOProWaitingState,
} from "./YGOProWaitingState";
import { YGOProDeckCreator } from "@ygopro/deck/application/YGOProDeckCreator";
import { YGOProDeckValidator } from "@ygopro/deck/domain/YGOProDeckValidator";
import { NotOfficialCardError } from "@shared/deck/domain/errors/NotOfficialCardError";
import { BanListDeckError } from "@shared/deck/domain/errors/BanListDeckError";
import { encodeDeckErrorCode } from "@shared/deck/domain/errors/encodeDeckErrorCode";
import { AdmitToRoom } from "../../admission/application/AdmitToRoom";
import { ISocket } from "@shared/socket/domain/ISocket";
import { RoomLeague } from "@shared/room/admission/domain/RoomLeague";
import { PlayerCredential } from "@shared/room/admission/domain/PlayerCredential";
import { ErrorMessageType, YGOProStocChat } from "ygopro-msg-encode";

import { RANKED_READY_WINDOW_MS, RANKED_START_WINDOW_MS } from "../YGOProRoom";

// ---- helpers ----

// mercuryConfig.version = 4962 = 0x1362 → LE bytes: 0x62 0x13
const makeJoinData = (): Buffer => {
	const buf = Buffer.alloc(48);
	buf.writeUInt16LE(4962, 0);
	return buf;
};

// "Jaden" in UTF-16LE with no password separator (40 bytes)
const PLAYER_INFO_HEX =
	"4a006100640065006e00000000000000000000000000000000000000000000000000000000000000";

const makeJoinMessage = (): ClientMessage =>
	({
		data: makeJoinData(),
		previousMessage: Buffer.from(PLAYER_INFO_HEX, "hex"),
	}) as unknown as ClientMessage;

const makeDeckPayload = (): Buffer => {
	const main = [0x00000001, 0x00000002];
	const side: number[] = [];
	const buf = Buffer.alloc(4 + 4 + (main.length + side.length) * 4);
	let offset = 0;
	buf.writeUInt32LE(main.length, offset);
	offset += 4;
	buf.writeUInt32LE(side.length, offset);
	offset += 4;
	for (const code of [...main, ...side]) {
		buf.writeUInt32LE(code, offset);
		offset += 4;
	}
	return buf;
};

const makeClientMessage = (data: Buffer): ClientMessage =>
	({
		data,
		previousMessage: Buffer.alloc(0),
	}) as unknown as ClientMessage;

const makeAdmitToRoom = (): { run: jest.Mock } => ({ run: jest.fn() });

const makeLogger = (): jest.Mocked<Logger> =>
	({
		child: jest.fn().mockReturnThis(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		debug: jest.fn(),
	}) as unknown as jest.Mocked<Logger>;

describe("YGOProWaitingState.handleUpdateDeck", () => {
	let eventEmitter: EventEmitter;
	let mockLogger: jest.Mocked<Logger>;
	let mockAdmitToRoom: { run: jest.Mock };
	let mockDeckCreator: jest.Mocked<YGOProDeckCreator>;
	let mockDeckValidator: jest.Mocked<YGOProDeckValidator>;
	let mockRoom: jest.Mocked<YGOProRoom>;
	let mockPlayer: jest.Mocked<YGOProClient>;

	beforeEach(() => {
		eventEmitter = new EventEmitter();
		mockLogger = makeLogger();
		mockAdmitToRoom = makeAdmitToRoom();

		mockDeckCreator = {
			build: jest.fn(),
		} as unknown as jest.Mocked<YGOProDeckCreator>;

		mockDeckValidator = {
			validate: jest.fn().mockReturnValue(null),
		} as unknown as jest.Mocked<YGOProDeckValidator>;

		mockRoom = {
			mutex: {
				runExclusive: jest.fn().mockImplementation((fn: () => void) => fn()),
			},
			banListHash: 0,
			shouldValidateDeck: jest.fn().mockReturnValue(true),
			setDecksToPlayerUnsafe: jest.fn(),
			notReadyUnsafe: jest.fn(),
			messageSender: {
				errorMessage: jest.fn().mockReturnValue(Buffer.alloc(0)),
			},
			hostInfo: { rule: 0 },
		} as unknown as jest.Mocked<YGOProRoom>;

		mockPlayer = {
			isSpectator: false,
			isInternal: false,
			position: 0,
			logger: makeLogger(),
			sendMessageToClient: jest.fn(),
		} as unknown as jest.Mocked<YGOProClient>;

		new YGOProWaitingState(
			mockAdmitToRoom as unknown as AdmitToRoom,
			eventEmitter,
			mockLogger,
			mockDeckCreator,
			mockDeckValidator,
		);
	});

	const emitUpdateDeck = (player: jest.Mocked<YGOProClient>): Promise<void> => {
		const data = makeDeckPayload();
		const message = makeClientMessage(data);
		return new Promise((resolve) => {
			setImmediate(() => resolve());
			eventEmitter.emit(Commands.UPDATE_DECK as unknown as string, message, mockRoom, player);
		});
	};

	describe("when player.isInternal is false (human player)", () => {
		it("should call the deck validator", async () => {
			const fakeDeck = { allCards: [] };
			mockDeckCreator.build.mockResolvedValue(fakeDeck as never);
			mockDeckValidator.validate.mockReturnValue(null);

			await emitUpdateDeck(mockPlayer);

			expect(mockDeckValidator.validate).toHaveBeenCalledWith(fakeDeck);
		});

		it("should reject when the deck fails validation (regression test)", async () => {
			const fakeDeck = { allCards: [{ code: 12345 }] };
			const deckError = new NotOfficialCardError(12345);
			mockDeckCreator.build.mockResolvedValue(fakeDeck as never);
			mockDeckValidator.validate.mockReturnValue(deckError);

			await emitUpdateDeck(mockPlayer);

			expect(mockRoom.notReadyUnsafe).toHaveBeenCalled();
			expect(mockPlayer.sendMessageToClient).toHaveBeenCalled();
		});
	});

	describe("when player.isInternal is true (bot player)", () => {
		beforeEach(() => {
			(mockPlayer as unknown as Record<string, unknown>)["isInternal"] = true;
		});

		it("should NOT call the deck validator", async () => {
			const fakeDeck = { allCards: [] };
			mockDeckCreator.build.mockResolvedValue(fakeDeck as never);

			await emitUpdateDeck(mockPlayer);

			expect(mockDeckValidator.validate).not.toHaveBeenCalled();
		});

		it("should accept a deck that would normally fail validation", async () => {
			const fakeDeck = { allCards: [{ code: 12345 }] };
			mockDeckCreator.build.mockResolvedValue(fakeDeck as never);
			mockDeckValidator.validate.mockReturnValue(new NotOfficialCardError(12345));

			await emitUpdateDeck(mockPlayer);

			expect(mockRoom.notReadyUnsafe).not.toHaveBeenCalled();
			expect(mockPlayer.sendMessageToClient).not.toHaveBeenCalled();
			expect(mockRoom.setDecksToPlayerUnsafe).toHaveBeenCalled();
		});

		it("should set the deck via setDecksToPlayerUnsafe", async () => {
			const fakeDeck = { allCards: [] };
			mockDeckCreator.build.mockResolvedValue(fakeDeck as never);

			await emitUpdateDeck(mockPlayer);

			expect(mockRoom.setDecksToPlayerUnsafe).toHaveBeenCalledWith(mockPlayer.position, fakeDeck);
		});

		it("isInternal check happens before validator — validator never invoked regardless of shouldValidateDeck()", async () => {
			mockRoom.shouldValidateDeck.mockReturnValue(true);
			const fakeDeck = { allCards: [] };
			mockDeckCreator.build.mockResolvedValue(fakeDeck as never);

			await emitUpdateDeck(mockPlayer);

			expect(mockRoom.shouldValidateDeck).not.toHaveBeenCalled();
			expect(mockDeckValidator.validate).not.toHaveBeenCalled();
		});
	});

	describe("deck error code is encoded (DeckErrorType in high 4 bits)", () => {
		const errorMessageMock = () => mockRoom.messageSender.errorMessage as unknown as jest.Mock;

		it("sends DECKERROR with the encoded code when build returns a DeckError", async () => {
			const deckError = new BanListDeckError(12345); // type=CARD_BANLISTED(1), code=12345
			mockDeckCreator.build.mockResolvedValue(deckError as never);

			await emitUpdateDeck(mockPlayer);

			expect(errorMessageMock()).toHaveBeenCalledWith(
				ErrorMessageType.DECKERROR,
				encodeDeckErrorCode(deckError.type, deckError.code),
			);
			// Must NOT be the old bug (raw unshifted type)
			expect(errorMessageMock()).not.toHaveBeenCalledWith(
				ErrorMessageType.DECKERROR,
				deckError.type,
			);
		});

		it("sends DECKERROR with the encoded code when validation fails", async () => {
			const fakeDeck = { allCards: [{ code: 12345 }] };
			const deckError = new NotOfficialCardError(12345); // type=CARD_UNOFFICIAL(0xa), code=12345
			mockDeckCreator.build.mockResolvedValue(fakeDeck as never);
			mockDeckValidator.validate.mockReturnValue(deckError);

			await emitUpdateDeck(mockPlayer);

			expect(errorMessageMock()).toHaveBeenCalledWith(
				ErrorMessageType.DECKERROR,
				encodeDeckErrorCode(deckError.type, deckError.code),
			);
		});
	});
});

describe("YGOProWaitingState.handleJoin", () => {
	let eventEmitter: EventEmitter;
	let mockLogger: jest.Mocked<Logger>;
	let mockAdmitToRoom: { run: jest.Mock };
	let mockDeckCreator: jest.Mocked<YGOProDeckCreator>;
	let mockDeckValidator: jest.Mocked<YGOProDeckValidator>;
	let mockRoom: jest.Mocked<YGOProRoom>;
	let mockSocket: jest.Mocked<ISocket>;
	let admissionTarget: object;

	const makeMockRoom = (): jest.Mocked<YGOProRoom> =>
		({
			ranked: false,
			players: [],
			mutex: {
				runExclusive: jest.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
			},
			admissionTarget: jest.fn().mockReturnValue(admissionTarget),
			messageSender: {
				errorMessage: jest.fn().mockReturnValue(Buffer.alloc(0)),
			},
		}) as unknown as jest.Mocked<YGOProRoom>;

	const makeMockSocket = (): jest.Mocked<ISocket> =>
		({
			id: "sock-test",
			remoteAddress: "127.0.0.1",
			closed: false,
			send: jest.fn(),
			close: jest.fn(),
			destroy: jest.fn(),
			removeAllListeners: jest.fn(),
		}) as unknown as jest.Mocked<ISocket>;

	const emitJoin = (room: jest.Mocked<YGOProRoom>, socket: jest.Mocked<ISocket>): Promise<void> => {
		const message = makeJoinMessage();
		return new Promise((resolve) => {
			setImmediate(() => resolve());
			eventEmitter.emit("JOIN", message, room, socket);
		});
	};

	beforeEach(() => {
		eventEmitter = new EventEmitter();
		mockLogger = makeLogger();
		mockAdmitToRoom = makeAdmitToRoom();
		admissionTarget = { league: "casual" };

		mockDeckCreator = {
			build: jest.fn(),
		} as unknown as jest.Mocked<YGOProDeckCreator>;

		mockDeckValidator = {
			validate: jest.fn().mockReturnValue(null),
		} as unknown as jest.Mocked<YGOProDeckValidator>;

		mockRoom = makeMockRoom();
		mockSocket = makeMockSocket();

		new YGOProWaitingState(
			mockAdmitToRoom as unknown as AdmitToRoom,
			eventEmitter,
			mockLogger,
			mockDeckCreator,
			mockDeckValidator,
		);
	});

	it("delegates the join to AdmitToRoom with the room's admission target", async () => {
		await emitJoin(mockRoom, mockSocket);

		expect(mockRoom.admissionTarget).toHaveBeenCalledWith(mockSocket, expect.anything());
		expect(mockAdmitToRoom.run).toHaveBeenCalledWith(
			mockSocket,
			expect.anything(),
			admissionTarget,
		);
	});

	it("rejects a duplicate name without delegating to AdmitToRoom", async () => {
		mockRoom = makeMockRoom();
		(mockRoom as unknown as { players: unknown[] }).players = [
			{ name: "Jaden", socket: { remoteAddress: "127.0.0.1", closed: true } },
		];

		await emitJoin(mockRoom, mockSocket);

		expect(mockAdmitToRoom.run).not.toHaveBeenCalled();
		expect(mockSocket.send).toHaveBeenCalled();
		expect(mockSocket.close).toHaveBeenCalled();
	});
});

describe("YGOProWaitingState.handleToDuel (spectator -> player)", () => {
	let eventEmitter: EventEmitter;

	const makeRoom = (league: RoomLeague): jest.Mocked<YGOProRoom> =>
		({
			league,
			mutex: {
				runExclusive: jest.fn().mockImplementation((fn: () => void) => fn()),
			},
			spectatorToPlayerUnsafe: jest.fn(),
			movePlayerToAnotherCellUnsafe: jest.fn(),
		}) as unknown as jest.Mocked<YGOProRoom>;

	const makeSpectator = (credential: PlayerCredential | null): jest.Mocked<YGOProClient> =>
		({
			isSpectator: true,
			credential,
			name: "X",
			logger: makeLogger(),
		}) as unknown as jest.Mocked<YGOProClient>;

	const emitToDuel = (
		room: jest.Mocked<YGOProRoom>,
		player: jest.Mocked<YGOProClient>,
	): Promise<void> =>
		new Promise((resolve) => {
			setImmediate(() => resolve());
			eventEmitter.emit(
				Commands.TO_DUEL as unknown as string,
				makeClientMessage(Buffer.alloc(0)),
				room,
				player,
			);
		});

	beforeEach(() => {
		eventEmitter = new EventEmitter();
		new YGOProWaitingState(
			makeAdmitToRoom() as unknown as AdmitToRoom,
			eventEmitter,
			makeLogger(),
			{ build: jest.fn() } as unknown as YGOProDeckCreator,
			{ validate: jest.fn() } as unknown as YGOProDeckValidator,
		);
	});

	it("does NOT seat a wrong-league spectator (external in a Verified room)", async () => {
		const room = makeRoom(RoomLeague.Verified);
		const spectator = makeSpectator({ kind: "external", userId: "u" });

		await emitToDuel(room, spectator);

		expect(room.spectatorToPlayerUnsafe).not.toHaveBeenCalled();
	});

	it("seats a matching-league spectator (verified in a Verified room)", async () => {
		const room = makeRoom(RoomLeague.Verified);
		const spectator = makeSpectator({ kind: "verified", userId: "u" });

		await emitToDuel(room, spectator);

		expect(room.spectatorToPlayerUnsafe).toHaveBeenCalledWith(spectator);
	});

	it("seats anyone in a casual room", async () => {
		const room = makeRoom(RoomLeague.Casual);
		const spectator = makeSpectator({ kind: "guest", name: "X" });

		await emitToDuel(room, spectator);

		expect(room.spectatorToPlayerUnsafe).toHaveBeenCalledWith(spectator);
	});

	it("does NOT seat any spectator in an isDirectRanked room", async () => {
		const room = makeRoom(RoomLeague.External);
		room.isDirectRanked = true;
		const spectator = makeSpectator({ kind: "verified", userId: "u" });

		await emitToDuel(room, spectator);

		expect(room.spectatorToPlayerUnsafe).not.toHaveBeenCalled();
	});
});

describe("YGOProWaitingState.handleTryStart", () => {
	it("calls room.revealRealPlayerNames before duelStartMessage when isDirectRanked is true", () => {
		const eventEmitter = new EventEmitter();
		const callOrder: string[] = [];
		const room = {
			allPlayersReady: true,
			isDirectRanked: true,
			clients: [],
			players: [],
			noReconnect: true,
			revealRealPlayerNames: jest.fn().mockImplementation(() => {
				callOrder.push("revealRealPlayerNames");
			}),
			messageSender: {
				duelStartMessage: jest.fn().mockImplementation(() => {
					callOrder.push("duelStartMessage");
					return Buffer.alloc(0);
				}),
			},
			sendDeckCountMessage: jest.fn(),
			toRPS: jest.fn(),
			createMatch: jest.fn(),
			rps: jest.fn(),
			getTeamPlayers: jest.fn().mockReturnValue([]),
		} as unknown as YGOProRoom;

		const hostPlayer = {
			host: true,
			logger: makeLogger(),
			sendMessageToClient: jest.fn(),
		} as unknown as YGOProClient;

		(room.clients as any[]).push(hostPlayer);

		new YGOProWaitingState(
			makeAdmitToRoom() as unknown as AdmitToRoom,
			eventEmitter,
			makeLogger(),
			{ build: jest.fn() } as unknown as YGOProDeckCreator,
			{ validate: jest.fn() } as unknown as YGOProDeckValidator,
		);

		eventEmitter.emit(
			Commands.TRY_START as unknown as string,
			makeClientMessage(Buffer.alloc(0)),
			room,
			hostPlayer,
		);

		expect(room.revealRealPlayerNames).toHaveBeenCalled();
		expect(callOrder).toEqual(["revealRealPlayerNames", "duelStartMessage"]);
	});
});

describe("YGOProWaitingState ranked kick windows (direct ranked #TT rooms)", () => {
	type FakePlayer = jest.Mocked<YGOProClient> & { isReady: boolean };
	type FakeRoom = jest.Mocked<YGOProRoom> & { players: FakePlayer[] };

	let eventEmitter: EventEmitter;
	let admitToRoom: { run: jest.Mock };

	const makePlayer = (name: string, host: boolean, isReady: boolean): FakePlayer =>
		({
			name,
			host,
			isReady,
			position: host ? 0 : 1,
			isSpectator: false,
			isInternal: false,
			logger: makeLogger(),
			socket: {
				id: `socket-${name}`,
				remoteAddress: "127.0.0.1",
				closed: false,
				close: jest.fn(),
			},
			sendMessageToClient: jest.fn(),
		}) as unknown as FakePlayer;

	const makeRoom = (players: FakePlayer[], isDirectRanked = true): FakeRoom => {
		const room = {
			id: 1,
			isDirectRanked,
			finalizing: false,
			noReconnect: true,
			players,
			clients: [],
			banListHash: 0,
			hostInfo: { rule: 0 },
			shouldValidateDeck: jest.fn().mockReturnValue(true),
			setDecksToPlayerUnsafe: jest.fn(),
			notReadyUnsafe: jest.fn(),
			revealRealPlayerNames: jest.fn(),
			getTeamPlayers: jest.fn().mockReturnValue([]),
			createMatch: jest.fn(),
			rps: jest.fn(),
			admissionTarget: jest.fn().mockReturnValue({}),
			removePlayerBySocket: jest.fn(),
			removeSpectatorBySocket: jest.fn(),
			mutex: {
				runExclusive: jest.fn().mockImplementation((fn: () => unknown) => fn()),
			},
			messageSender: {
				errorMessage: jest.fn().mockReturnValue(Buffer.alloc(0)),
			},
		};
		Object.defineProperty(room, "allPlayersReady", {
			get: () => room.players.every((player) => player.isReady),
		});

		return room as unknown as FakeRoom;
	};

	const createState = (): YGOProWaitingState => {
		admitToRoom = { run: jest.fn() };

		return new YGOProWaitingState(
			admitToRoom as unknown as AdmitToRoom,
			eventEmitter,
			makeLogger(),
			{ build: jest.fn().mockResolvedValue({ allCards: [] }) } as unknown as YGOProDeckCreator,
			{ validate: jest.fn().mockReturnValue(null) } as unknown as YGOProDeckValidator,
		);
	};

	// handleJoin/handleUpdateDeck are async: drain the microtask queue without
	// touching the (faked) timer clock.
	const flush = async (): Promise<void> => {
		for (let i = 0; i < 20; i += 1) {
			await Promise.resolve();
		}
	};

	const join = async (room: FakeRoom, player: FakePlayer): Promise<void> => {
		admitToRoom.run.mockImplementation(async () => {
			room.players.push(player);
		});
		eventEmitter.emit("JOIN", makeJoinMessage(), room, player.socket);
		await flush();
	};

	const readyUp = async (room: FakeRoom, player: FakePlayer): Promise<void> => {
		player.isReady = true;
		eventEmitter.emit(
			Commands.UPDATE_DECK as unknown as string,
			makeClientMessage(makeDeckPayload()),
			room,
			player,
		);
		await flush();
	};

	const unready = async (room: FakeRoom, player: FakePlayer): Promise<void> => {
		player.isReady = false;
		eventEmitter.emit(
			Commands.NOT_READY as unknown as string,
			makeClientMessage(Buffer.alloc(0)),
			room,
			player,
		);
		await flush();
	};

	const tryStart = (room: FakeRoom, player: FakePlayer): void => {
		eventEmitter.emit(
			Commands.TRY_START as unknown as string,
			makeClientMessage(Buffer.alloc(0)),
			room,
			player,
		);
	};

	const lastChatMessage = (player: FakePlayer): string => {
		const calls = (player.sendMessageToClient as unknown as jest.Mock).mock.calls;
		const last = calls[calls.length - 1][0] as Buffer;

		return new YGOProStocChat().fromFullPayload(last).msg;
	};

	beforeEach(() => {
		jest.useFakeTimers();
		eventEmitter = new EventEmitter();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("kicks the player who never readies up when the ready window expires", async () => {
		const host = makePlayer("Host", true, true);
		const guest = makePlayer("Guest", false, false);
		const room = makeRoom([host, guest]);
		createState();

		await readyUp(room, host);

		jest.advanceTimersByTime(RANKED_READY_WINDOW_MS);

		expect(guest.socket.close).toHaveBeenCalledTimes(1);
		expect(host.socket.close).not.toHaveBeenCalled();
		expect(lastChatMessage(guest)).toBe(RANKED_READY_KICK_MESSAGE);
	});

	it("kicks both players when nobody readies up", async () => {
		const host = makePlayer("Host", true, false);
		const guest = makePlayer("Guest", false, false);
		const room = makeRoom([host]);
		createState();

		await join(room, guest);

		jest.advanceTimersByTime(RANKED_READY_WINDOW_MS);

		expect(host.socket.close).toHaveBeenCalledTimes(1);
		expect(guest.socket.close).toHaveBeenCalledTimes(1);
		expect(lastChatMessage(host)).toBe(RANKED_READY_KICK_MESSAGE);
	});

	it("kicks only the host when the start window expires", async () => {
		const host = makePlayer("Host", true, true);
		const guest = makePlayer("Guest", false, true);
		const room = makeRoom([host, guest]);
		createState();

		await readyUp(room, host);

		jest.advanceTimersByTime(RANKED_START_WINDOW_MS);

		expect(host.socket.close).toHaveBeenCalledTimes(1);
		expect(guest.socket.close).not.toHaveBeenCalled();
		expect(lastChatMessage(host)).toBe(RANKED_START_KICK_MESSAGE);
	});

	it("cancels both windows once the host starts the duel", async () => {
		const host = makePlayer("Host", true, true);
		const guest = makePlayer("Guest", false, true);
		const room = makeRoom([host, guest]);
		createState();

		await readyUp(room, host);
		tryStart(room, host);

		jest.advanceTimersByTime(RANKED_READY_WINDOW_MS + RANKED_START_WINDOW_MS);

		expect(host.socket.close).not.toHaveBeenCalled();
		expect(guest.socket.close).not.toHaveBeenCalled();
	});

	it("arms a fresh start window when the room becomes ready again", async () => {
		const host = makePlayer("Host", true, true);
		const guest = makePlayer("Guest", false, true);
		const room = makeRoom([host, guest]);
		createState();

		await readyUp(room, host);
		jest.advanceTimersByTime(10_000);

		await unready(room, guest);
		jest.advanceTimersByTime(10_000);

		await readyUp(room, guest);
		jest.advanceTimersByTime(14_000);
		expect(host.socket.close).not.toHaveBeenCalled();

		jest.advanceTimersByTime(2_000);

		expect(host.socket.close).toHaveBeenCalledTimes(1);
		expect(guest.socket.close).not.toHaveBeenCalled();
	});

	it("arms a fresh ready window for the player who fills an empty seat", async () => {
		const host = makePlayer("Host", true, true);
		const firstGuest = makePlayer("Guest1", false, false);
		const room = makeRoom([host]);
		createState();

		await join(room, firstGuest);
		jest.advanceTimersByTime(5_000);

		room.players.splice(1, 1);
		const secondGuest = makePlayer("Guest2", false, false);
		await join(room, secondGuest);

		jest.advanceTimersByTime(12_000);
		expect(secondGuest.socket.close).not.toHaveBeenCalled();

		jest.advanceTimersByTime(5_000);

		expect(secondGuest.socket.close).toHaveBeenCalledTimes(1);
		expect(host.socket.close).not.toHaveBeenCalled();
	});

	it("re-checks the room at expiry and does nothing once it is no longer full", async () => {
		const host = makePlayer("Host", true, true);
		const guest = makePlayer("Guest", false, false);
		const room = makeRoom([host, guest]);
		createState();

		await readyUp(room, host);
		room.players.splice(1, 1);

		jest.advanceTimersByTime(RANKED_READY_WINDOW_MS);

		expect(host.socket.close).not.toHaveBeenCalled();
		expect(guest.socket.close).not.toHaveBeenCalled();
	});

	it("does not extend the ready window when the other player readies up", async () => {
		const host = makePlayer("Host", true, false);
		const guest = makePlayer("Guest", false, false);
		const room = makeRoom([host]);
		createState();

		await join(room, guest);
		jest.advanceTimersByTime(10_000);

		await readyUp(room, host);
		jest.advanceTimersByTime(5_000);

		expect(guest.socket.close).toHaveBeenCalledTimes(1);
		expect(host.socket.close).not.toHaveBeenCalled();
	});

	it("never arms a window in a room that is not direct ranked", async () => {
		const host = makePlayer("Host", true, false);
		const guest = makePlayer("Guest", false, false);
		const room = makeRoom([host], false);
		createState();

		await join(room, guest);

		jest.advanceTimersByTime(RANKED_READY_WINDOW_MS + RANKED_START_WINDOW_MS);

		expect(host.socket.close).not.toHaveBeenCalled();
		expect(guest.socket.close).not.toHaveBeenCalled();
	});

	it("clears pending windows when the state is detached", async () => {
		const host = makePlayer("Host", true, true);
		const guest = makePlayer("Guest", false, false);
		const room = makeRoom([host, guest]);
		const state = createState();

		await readyUp(room, host);
		state.removeAllListener();

		jest.advanceTimersByTime(RANKED_READY_WINDOW_MS);

		expect(guest.socket.close).not.toHaveBeenCalled();
		expect(host.socket.close).not.toHaveBeenCalled();
	});
});
