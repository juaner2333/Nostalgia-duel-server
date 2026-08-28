import { EventEmitter } from "stream";

import { Commands } from "@shared/messages/Commands";
import { ClientMessage } from "@shared/messages/MessageProcessor";
import { Logger } from "@shared/logger/domain/Logger";

import { YGOProClient } from "../../../client/domain/YGOProClient";
import { YGOProRoom } from "../YGOProRoom";
import { YGOProSideDeckingState } from "./YGOProSideDeckingState";
import { YGOProDeckCreator } from "@ygopro/deck/application/YGOProDeckCreator";
import { YGOProDeckValidator } from "@ygopro/deck/domain/YGOProDeckValidator";
import { BanListDeckError } from "@shared/deck/domain/errors/BanListDeckError";
import { NotOfficialCardError } from "@shared/deck/domain/errors/NotOfficialCardError";
import { encodeDeckErrorCode } from "@shared/deck/domain/errors/encodeDeckErrorCode";

import { ErrorMessageType } from "ygopro-msg-encode";

import MercuryRoomList from "../../infrastructure/YGOProRoomList";
import WebSocketSingleton from "../../../../web-socket-server/WebSocketSingleton";
import { YGOProRoomMother } from "@test-support/mothers/room/YGOProRoomMother";
import { Team } from "@shared/room/Team";
import { DuelState } from "@shared/room/domain/YgoRoom";
import { config } from "../../../../config";

// ---- side-deck timeout lifecycle ----

jest.mock("../../../../web-socket-server/WebSocketSingleton", () => {
	const mockBroadcast = jest.fn();
	return {
		__esModule: true,
		default: {
			getInstance: () => ({ broadcast: mockBroadcast }),
		},
		mockBroadcast,
	};
});

const makeLogger = () => ({
	child: jest.fn().mockReturnThis(),
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn(),
});

const makeSocket = (id: string) => ({
	id,
	transport: "tcp",
	closed: false,
	remoteAddress: "127.0.0.1",
	send: jest.fn(),
	onMessage: jest.fn(),
	onClose: jest.fn(),
	close: jest.fn(),
	destroy: jest.fn(),
	removeAllListeners: jest.fn(),
});

describe("YGOProSideDeckingState — side-deck timeout lifecycle", () => {
	const SIDE_TIMEOUT_MS = config.sideTimeoutMinutes * 60_000;

	let room: YGOProRoom;
	let emitter: EventEmitter;
	let sockets: ReturnType<typeof makeSocket>[];
	let players: YGOProClient[];
	let deckCreator: jest.Mocked<YGOProDeckCreator>;
	let deckValidator: jest.Mocked<YGOProDeckValidator>;

	beforeEach(() => {
		jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick"] });

		emitter = new EventEmitter();
		room = YGOProRoomMother.create({ command: "1109#1001" });
		MercuryRoomList.addRoom(room);

		sockets = [makeSocket("sock-0"), makeSocket("sock-1")];
		players = [
			new YGOProClient({
				name: "PlayerOne",
				socket: sockets[0] as never,
				logger: makeLogger() as never,
				position: 0,
				room,
				host: true,
				id: "p1",
				team: Team.PLAYER,
			}),
			new YGOProClient({
				name: "PlayerTwo",
				socket: sockets[1] as never,
				logger: makeLogger() as never,
				position: 1,
				room,
				host: false,
				id: "p2",
				team: Team.OPPONENT,
			}),
		];
		room.addPlayerUnsafe(players[0]);
		room.addPlayerUnsafe(players[1]);

		deckCreator = {
			build: jest.fn(),
		} as unknown as jest.Mocked<YGOProDeckCreator>;
		deckValidator = {
			validate: jest.fn().mockReturnValue(null),
		} as unknown as jest.Mocked<YGOProDeckValidator>;

		// Schedules one side-deck timer per seated player.
		new YGOProSideDeckingState(emitter, makeLogger(), deckCreator, deckValidator, room);
	});

	afterEach(() => {
		jest.useRealTimers();
		(WebSocketSingleton.getInstance().broadcast as jest.Mock).mockClear();
		const rooms = MercuryRoomList.getRooms();
		while (rooms.length) {
			MercuryRoomList.deleteRoom(rooms[0]);
		}
	});

	const emitUpdateDeck = (player: YGOProClient): Promise<void> => {
		const message = makeClientMessage(makeDeckPayload());
		return new Promise((resolve) => {
			setImmediate(() => resolve());
			emitter.emit(Commands.UPDATE_DECK as unknown as string, message, room, player);
		});
	};

	it("finalizes the room when a seated player exhausts the side-deck window", () => {
		const roomId = room.id;
		expect(jest.getTimerCount()).toBe(2);

		jest.advanceTimersByTime(SIDE_TIMEOUT_MS);

		// Unified teardown ran: room gone from the list, both sockets closed,
		// all timers cancelled, exactly one REMOVE-ROOM broadcast.
		expect(MercuryRoomList.findById(roomId)).toBeNull();
		expect(room.finalizing).toBe(true);
		expect(sockets[0].destroy).toHaveBeenCalled();
		expect(sockets[1].destroy).toHaveBeenCalled();
		expect(jest.getTimerCount()).toBe(0);
		const broadcast = WebSocketSingleton.getInstance().broadcast as jest.Mock;
		expect(broadcast).toHaveBeenCalledTimes(1);
		expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ action: "REMOVE-ROOM" }));
	});

	it("keeps the room alive when a player submits the side deck in time", async () => {
		players.forEach((player) =>
			player.setDeck({
				isSideDeckValid: jest.fn().mockReturnValue(true),
			} as never),
		);
		deckCreator.build.mockResolvedValue({ allCards: [] } as never);
		room.setClientWhoChoosesTurn(players[0]);

		await emitUpdateDeck(players[0]);

		// Only the submitting player's timer is cleared; the room stays listed.
		expect(jest.getTimerCount()).toBe(1);
		expect(MercuryRoomList.findById(room.id)).toBe(room);

		// Advancing almost the full window (remaining player still at 1 minute)
		// must not tear the room down.
		jest.advanceTimersByTime(SIDE_TIMEOUT_MS - 60_000);
		expect(MercuryRoomList.findById(room.id)).toBe(room);

		// Both ready → normal next-duel flow (choosing order), all timers gone.
		await emitUpdateDeck(players[1]);

		expect(room.duelState).toBe(DuelState.CHOOSING_ORDER);
		expect(jest.getTimerCount()).toBe(0);
		expect(WebSocketSingleton.getInstance().broadcast).not.toHaveBeenCalled();
	});
});

// ---- helpers ----

// A minimal CTOS_UPDATE_DECK payload: mainCount, sideCount, then card codes.
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
	({ data, previousMessage: Buffer.alloc(0) }) as unknown as ClientMessage;

describe("YGOProSideDeckingState.handleUpdateDeck — deck error code is encoded", () => {
	let eventEmitter: EventEmitter;
	let mockLogger: jest.Mocked<Logger>;
	let mockDeckCreator: jest.Mocked<YGOProDeckCreator>;
	let mockDeckValidator: jest.Mocked<YGOProDeckValidator>;
	let mockRoom: jest.Mocked<YGOProRoom>;
	let mockPlayer: jest.Mocked<YGOProClient>;

	const errorMessageMock = () => mockRoom.messageSender.errorMessage as unknown as jest.Mock;

	beforeEach(() => {
		eventEmitter = new EventEmitter();

		mockLogger = {
			child: jest.fn().mockReturnThis(),
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		} as unknown as jest.Mocked<Logger>;

		mockDeckCreator = { build: jest.fn() } as unknown as jest.Mocked<YGOProDeckCreator>;
		mockDeckValidator = {
			validate: jest.fn().mockReturnValue(null),
		} as unknown as jest.Mocked<YGOProDeckValidator>;

		mockRoom = {
			players: [], // empty → constructor schedules no side-deck timers
			banListHash: 0,
			hostInfo: { rule: 0 }, // referenced by the warn() log on the error paths
			shouldValidateDeck: jest.fn().mockReturnValue(true),
			notReadyUnsafe: jest.fn(),
			setDecksToPlayerUnsafe: jest.fn(),
			messageSender: {
				errorMessage: jest.fn().mockReturnValue(Buffer.alloc(0)),
			},
		} as unknown as jest.Mocked<YGOProRoom>;

		mockPlayer = {
			isSpectator: false,
			position: 0,
			deck: { isSideDeckValid: jest.fn().mockReturnValue(true) },
			logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
			sendMessageToClient: jest.fn(),
		} as unknown as jest.Mocked<YGOProClient>;

		new YGOProSideDeckingState(
			eventEmitter,
			mockLogger,
			mockDeckCreator,
			mockDeckValidator,
			mockRoom,
		);
	});

	const emitUpdateDeck = (): Promise<void> => {
		const message = makeClientMessage(makeDeckPayload());
		return new Promise((resolve) => {
			setImmediate(() => resolve());
			eventEmitter.emit(Commands.UPDATE_DECK as unknown as string, message, mockRoom, mockPlayer);
		});
	};

	it("sends DECKERROR with the encoded code when build returns a DeckError", async () => {
		const deckError = new BanListDeckError(12345); // type=CARD_BANLISTED(1), code=12345
		mockDeckCreator.build.mockResolvedValue(deckError as never);

		await emitUpdateDeck();

		expect(errorMessageMock()).toHaveBeenCalledWith(
			ErrorMessageType.DECKERROR,
			encodeDeckErrorCode(deckError.type, deckError.code),
		);
		expect(errorMessageMock()).not.toHaveBeenCalledWith(
			ErrorMessageType.DECKERROR,
			deckError.type, // the old bug: raw unshifted type
		);
	});

	it("sends DECKERROR with the encoded code when validation fails", async () => {
		const fakeDeck = { allCards: [{ code: 12345 }] };
		const deckError = new NotOfficialCardError(12345); // type=CARD_UNOFFICIAL(0xa), code=12345
		mockDeckCreator.build.mockResolvedValue(fakeDeck as never);
		mockDeckValidator.validate.mockReturnValue(deckError);

		await emitUpdateDeck();

		expect(errorMessageMock()).toHaveBeenCalledWith(
			ErrorMessageType.DECKERROR,
			encodeDeckErrorCode(deckError.type, deckError.code),
		);
	});
});
