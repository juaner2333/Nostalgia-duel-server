/**
 * YGOProDisconnectHandler — 90s reconnect grace for started human rooms.
 *
 * When ALL players of a started, non-AI room disconnect, the room must be
 * retained for a bounded window (seats + duel state) so both players can
 * recover by name. WAITING rooms, matchmaking reservations and AI (noHost)
 * rooms keep their immediate teardown lifecycle.
 */

jest.mock("../../../web-socket-server/WebSocketSingleton", () => {
	const mockBroadcast = jest.fn();
	return {
		__esModule: true,
		default: {
			getInstance: () => ({ broadcast: mockBroadcast }),
		},
		mockBroadcast,
	};
});

import { EventEmitter } from "stream";

import { YGOProDisconnectHandler } from "./YGOProDisconnectHandler";
import { FinalizeYGOProRoom } from "./FinalizeYGOProRoom";
import { DuelState } from "@shared/room/domain/YgoRoom";
import { YGOProRoomFinder } from "./YGOProRoomFinder";
import { YGOProClient } from "@ygopro/client/domain/YGOProClient";
import { YGOProRoom } from "@ygopro/room/domain/YGOProRoom";
import MercuryRoomList from "@ygopro/room/infrastructure/YGOProRoomList";
import WebSocketSingleton from "../../../web-socket-server/WebSocketSingleton";
import { Team } from "@shared/room/Team";
import { ISocket, SocketTransport } from "@shared/socket/domain/ISocket";
import { Logger } from "@shared/logger/domain/Logger";
import { MessageRepositoryMock } from "@test-support/mocks/MessageRepositoryMock";
import { PlayerInfoMessageMother } from "@test-support/mothers/PlayerInfoMessageMother";
import { YGOProSideDeckingState } from "../domain/states/YGOProSideDeckingState";

import { RECONNECT_GRACE_MS } from "../domain/YGOProRoom";

jest.useFakeTimers();

// ---------- helpers ----------

const makeLogger = (): jest.Mocked<Logger> =>
	({
		child: jest.fn().mockReturnThis(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		debug: jest.fn(),
	}) as unknown as jest.Mocked<Logger>;

class SocketStub implements ISocket {
	id = `sock-${Math.random().toString(36).slice(2)}`;
	roomId?: number;
	resolvedUserId?: string;
	readonly transport: SocketTransport = "tcp";
	remoteAddress = "127.0.0.1";
	closed = false;
	readonly sends: Buffer[] = [];
	private closeCallback?: () => void;

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
		this.closed = true;
	}

	removeAllListeners(): void {
		this.closeCallback = undefined;
	}
}

const buildPlayer = (
	room: YGOProRoom,
	name: string,
	socket: SocketStub,
	team: Team,
	host: boolean,
): YGOProClient =>
	new YGOProClient({
		name,
		socket,
		logger: makeLogger(),
		position: team === Team.PLAYER ? 0 : 1,
		host,
		id: null,
		team,
		room,
	});

const createStartedRoom = (
	id: number,
	logger: jest.Mocked<Logger>,
	state: DuelState = DuelState.DUELING,
): {
	room: YGOProRoom;
	creator: YGOProClient;
	guest: YGOProClient;
	creatorSocket: SocketStub;
	guestSocket: SocketStub;
} => {
	const room = YGOProRoom.create(
		id,
		"ROOM",
		logger as never,
		new EventEmitter(),
		PlayerInfoMessageMother.create(),
		"creator-socket",
		new MessageRepositoryMock(),
	);
	(room as unknown as { _state: DuelState })._state = state;

	const creatorSocket = new SocketStub();
	const creator = buildPlayer(room, "Creator", creatorSocket, Team.PLAYER, true);
	room.addPlayerUnsafe(creator);

	const guestSocket = new SocketStub();
	const guest = buildPlayer(room, "Guest", guestSocket, Team.OPPONENT, false);
	room.addPlayerUnsafe(guest);

	MercuryRoomList.addRoom(room);
	return { room, creator, guest, creatorSocket, guestSocket };
};

const disconnect = (socketId: string, finder: YGOProRoomFinder): void => {
	new YGOProDisconnectHandler({ id: socketId } as never, finder).run();
};

const disconnectAll = (roomId: number, ids: string[], finder: YGOProRoomFinder): void => {
	for (const id of ids) {
		disconnect(id, finder);
	}
};

const graceLogs = (logger: jest.Mocked<Logger>): string[] =>
	(logger.info as jest.Mock).mock.calls
		.filter(([message]: [unknown]) => message === "reconnect_grace")
		.map(([, context]: [unknown, { event: string }]) => context.event);

const removeRoomBroadcasts = (broadcast: jest.Mock) =>
	broadcast.mock.calls.filter(([arg]) => arg?.action === "REMOVE-ROOM");

// ---------- tests ----------

describe("YGOProDisconnectHandler — 90s reconnect grace for started rooms", () => {
	const mockInstance = WebSocketSingleton.getInstance();

	beforeEach(() => {
		(mockInstance.broadcast as jest.Mock).mockClear();
	});

	afterEach(() => {
		jest.clearAllTimers();
		jest.restoreAllMocks();
		const rooms = MercuryRoomList.getRooms();
		while (rooms.length) {
			MercuryRoomList.deleteRoom(rooms[0]);
		}
	});

	it("retains a started room for 90s after both players disconnect, then finalizes once", () => {
		const logger = makeLogger();
		const { room, creatorSocket, guestSocket, creator, guest } = createStartedRoom(91011, logger);
		const roomId = room.id;

		creatorSocket.closed = true;
		disconnect(creator.socket.id as string, new YGOProRoomFinder());
		expect(room.finalizing).toBe(false);
		expect(MercuryRoomList.findById(roomId)).not.toBeNull();

		guestSocket.closed = true;
		disconnect(guest.socket.id as string, new YGOProRoomFinder());

		// within the window: room + seats retained
		expect(room.finalizing).toBe(false);
		expect(MercuryRoomList.findById(roomId)).not.toBeNull();
		expect(graceLogs(logger)).toEqual(["started"]);

		jest.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
		expect(MercuryRoomList.findById(roomId)).not.toBeNull();

		jest.advanceTimersByTime(1);
		expect(room.finalizing).toBe(true);
		expect(MercuryRoomList.findById(roomId)).toBeNull();
		expect(removeRoomBroadcasts(mockInstance.broadcast as jest.Mock)).toHaveLength(1);
		expect(graceLogs(logger)).toEqual(["started", "expired"]);

		// no second finalization after more elapsed time
		jest.advanceTimersByTime(RECONNECT_GRACE_MS * 2);
		expect(removeRoomBroadcasts(mockInstance.broadcast as jest.Mock)).toHaveLength(1);
	});

	it("a same-IP takeover within the grace cancels the pending cleanup", () => {
		const logger = makeLogger();
		const { room, creatorSocket, guestSocket, creator, guest } = createStartedRoom(91012, logger);
		const roomId = room.id;

		creatorSocket.closed = true;
		disconnect(creator.socket.id as string, new YGOProRoomFinder());
		guestSocket.closed = true;
		disconnect(guest.socket.id as string, new YGOProRoomFinder());
		expect(graceLogs(logger)).toEqual(["started"]);

		// the creator reconnects by name — the takeover cancels the grace
		room.reconnect(creator, new SocketStub());

		expect(graceLogs(logger)).toEqual(["started", "cancelled"]);
		jest.advanceTimersByTime(RECONNECT_GRACE_MS * 2);
		expect(room.finalizing).toBe(false);
		expect(MercuryRoomList.findById(roomId)).not.toBeNull();
	});

	it("restarts a fresh 90s window when the room goes fully disconnected again", () => {
		const logger = makeLogger();
		const { room, creator, guest, creatorSocket, guestSocket } = createStartedRoom(91013, logger);
		const roomId = room.id;

		creatorSocket.closed = true;
		disconnect(creator.socket.id as string, new YGOProRoomFinder());
		guestSocket.closed = true;
		disconnect(guest.socket.id as string, new YGOProRoomFinder());
		room.reconnect(creator, new SocketStub());
		expect(graceLogs(logger)).toEqual(["started", "cancelled"]);

		// the creator goes away again while the guest is still gone → the room is
		// fully disconnected once more and a NEW full window starts
		(creator.socket as SocketStub).closed = true;
		disconnect(creator.socket.id as string, new YGOProRoomFinder());
		expect(graceLogs(logger)).toEqual(["started", "cancelled", "started"]);

		jest.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
		expect(MercuryRoomList.findById(roomId)).not.toBeNull();
		jest.advanceTimersByTime(1);
		expect(MercuryRoomList.findById(roomId)).toBeNull();
	});

	it("repeated close events never extend the running window", () => {
		const logger = makeLogger();
		const { room, creatorSocket, guestSocket, creator, guest } = createStartedRoom(91014, logger);
		const roomId = room.id;

		creatorSocket.closed = true;
		disconnect(creator.socket.id as string, new YGOProRoomFinder());
		guestSocket.closed = true;
		disconnect(guest.socket.id as string, new YGOProRoomFinder());

		// the window is running; more close events arrive just before expiry
		jest.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
		disconnect(creator.socket.id as string, new YGOProRoomFinder());
		disconnect(guest.socket.id as string, new YGOProRoomFinder());

		// the timer was NOT restarted — expiry still happens at 90s
		jest.advanceTimersByTime(1);
		expect(MercuryRoomList.findById(roomId)).toBeNull();
		expect(graceLogs(logger)).toEqual(["started", "expired"]);
	});

	it("finalizes immediately when both players of a WAITING room disconnect", () => {
		const logger = makeLogger();
		const { room, creatorSocket, guestSocket, creator, guest } = createStartedRoom(
			91015,
			logger,
			DuelState.WAITING,
		);
		const roomId = room.id;

		creatorSocket.closed = true;
		disconnect(creator.socket.id as string, new YGOProRoomFinder());
		guestSocket.closed = true;
		disconnect(guest.socket.id as string, new YGOProRoomFinder());

		expect(room.finalizing).toBe(true);
		expect(MercuryRoomList.findById(roomId)).toBeNull();
		// no grace timeline at all
		expect(graceLogs(logger)).toEqual([]);
		jest.advanceTimersByTime(RECONNECT_GRACE_MS * 2);
		expect(removeRoomBroadcasts(mockInstance.broadcast as jest.Mock)).toHaveLength(1);
	});

	it("finalizes an AI room (noHost) immediately in a started phase", () => {
		const logger = makeLogger();
		const { room, creatorSocket, guestSocket, creator, guest } = createStartedRoom(91016, logger);
		const roomId = room.id;
		room.noHost = true;

		creatorSocket.closed = true;
		disconnect(creator.socket.id as string, new YGOProRoomFinder());
		guestSocket.closed = true;
		disconnect(guest.socket.id as string, new YGOProRoomFinder());

		expect(room.finalizing).toBe(true);
		expect(MercuryRoomList.findById(roomId)).toBeNull();
		expect(graceLogs(logger)).toEqual([]);
	});

	it("finalizes a STARTED matchmaking room immediately — no 90s grace (proposal: non-matchmaking duels only)", () => {
		const logger = makeLogger();
		const { room, creatorSocket, guestSocket, creator, guest } = createStartedRoom(91019, logger);
		const roomId = room.id;
		// isMatchmaking survives the reservation into the started duel; the flag
		// is never cleared, so the grace gate must exclude it explicitly.
		room.isMatchmaking = true;

		creatorSocket.closed = true;
		disconnect(creator.socket.id as string, new YGOProRoomFinder());
		guestSocket.closed = true;
		disconnect(guest.socket.id as string, new YGOProRoomFinder());

		expect(room.finalizing).toBe(true);
		expect(MercuryRoomList.findById(roomId)).toBeNull();
		expect(graceLogs(logger)).toEqual([]);
		// no timer is pending for a matchmaking room
		expect(jest.getTimerCount()).toBe(0);
	});

	it("does not start a grace when only one player of a started room disconnects", () => {
		const logger = makeLogger();
		const { room, creatorSocket, creator } = createStartedRoom(91017, logger);
		const roomId = room.id;

		creatorSocket.closed = true;
		disconnect(creator.socket.id as string, new YGOProRoomFinder());

		expect(room.finalizing).toBe(false);
		expect(MercuryRoomList.findById(roomId)).not.toBeNull();
		expect(graceLogs(logger)).toEqual([]);
		// the disconnected player keeps its seat for the by-name/token recovery
		expect(room.players.map((p) => p.name)).toEqual(["Creator", "Guest"]);

		jest.advanceTimersByTime(RECONNECT_GRACE_MS * 2);
		expect(room.finalizing).toBe(false);
		expect(graceLogs(logger)).toEqual([]);
	});

	it("clears a pending grace timer when the room is finalized by another path", () => {
		const logger = makeLogger();
		const { room, creatorSocket, guestSocket, creator, guest } = createStartedRoom(91018, logger);
		const roomId = room.id;

		creatorSocket.closed = true;
		disconnect(creator.socket.id as string, new YGOProRoomFinder());
		guestSocket.closed = true;
		disconnect(guest.socket.id as string, new YGOProRoomFinder());
		expect(graceLogs(logger)).toEqual(["started"]);

		// some other teardown path finalizes the room while the grace is pending
		FinalizeYGOProRoom.run(room);

		expect(MercuryRoomList.findById(roomId)).toBeNull();
		expect(graceLogs(logger)).toEqual(["started", "cancelled"]);

		// expiry must not fire afterwards
		jest.advanceTimersByTime(RECONNECT_GRACE_MS + 1);
		expect(removeRoomBroadcasts(mockInstance.broadcast as jest.Mock)).toHaveLength(1);
	});

	it("FinalizeYGOProRoom detaches the side-decking state and cancels its per-player intervals", () => {
		const logger = makeLogger();
		const { room } = createStartedRoom(91020, logger);

		// enter side-decking: one 60s tick interval per seated player
		const state = new YGOProSideDeckingState(
			new EventEmitter(),
			logger,
			{} as never,
			{} as never,
			room,
		);
		(room as unknown as { _roomState: unknown })._roomState = state;
		expect(jest.getTimerCount()).toBe(2);

		FinalizeYGOProRoom.run(room);

		// teardown must leave no state-owned timer behind
		expect(jest.getTimerCount()).toBe(0);
		expect((room as unknown as { _roomState: unknown })._roomState).toBeNull();
		// the room is removed as usual
		expect(MercuryRoomList.findById(room.id)).toBeNull();
	});
});
