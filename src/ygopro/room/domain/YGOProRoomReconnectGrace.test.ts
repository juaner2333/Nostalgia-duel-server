import { randomUUID } from "crypto";

import { YGOProClient } from "../../client/domain/YGOProClient";
import { Team } from "@shared/room/Team";
import { ISocket, SocketTransport } from "@shared/socket/domain/ISocket";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { YGOProRoomMother } from "@test-support/mothers/room/YGOProRoomMother";

import { RECONNECT_GRACE_MS, YGOProRoom } from "./YGOProRoom";

jest.useFakeTimers();

class SocketStub implements ISocket {
	id = randomUUID();
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

/** A room whose single player's socket is closed (full disconnect). */
const makeAbandonedRoom = (): {
	room: YGOProRoom;
	player: YGOProClient;
	socket: SocketStub;
} => {
	const room = YGOProRoomMother.create();
	const socket = new SocketStub();
	const player = new YGOProClient({
		name: "Jaden",
		socket,
		logger: new LoggerMock(),
		position: 0,
		host: true,
		id: null,
		team: Team.PLAYER,
		room,
	});
	room.addPlayerUnsafe(player);
	socket.closed = true; // the player's connection reported closed

	return { room, player, socket };
};

describe("YGOProRoom reconnect grace timer", () => {
	afterEach(() => {
		jest.clearAllTimers();
	});

	it("starts a single idempotent timer that expires exactly once after 90 seconds", () => {
		const { room } = makeAbandonedRoom();
		const onExpire = jest.fn();

		room.startReconnectGrace(onExpire);
		// a repeated disconnect event must NOT reset/extend the window
		room.startReconnectGrace(onExpire);

		jest.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
		expect(onExpire).not.toHaveBeenCalled();

		jest.advanceTimersByTime(1);
		expect(onExpire).toHaveBeenCalledTimes(1);

		// nothing further fires after the window already expired once
		jest.advanceTimersByTime(RECONNECT_GRACE_MS * 2);
		expect(onExpire).toHaveBeenCalledTimes(1);
	});

	it("cancel suppresses the pending expiry", () => {
		const { room } = makeAbandonedRoom();
		const onExpire = jest.fn();

		room.startReconnectGrace(onExpire);
		room.cancelReconnectGrace();

		jest.advanceTimersByTime(RECONNECT_GRACE_MS * 2);
		expect(onExpire).not.toHaveBeenCalled();
	});

	it("starts a fresh full window after a cancel (re-disconnect restarts the timer)", () => {
		const { room } = makeAbandonedRoom();
		const onExpire = jest.fn();

		room.startReconnectGrace(onExpire);
		room.cancelReconnectGrace();
		room.startReconnectGrace(onExpire);

		jest.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
		expect(onExpire).not.toHaveBeenCalled();
		jest.advanceTimersByTime(1);
		expect(onExpire).toHaveBeenCalledTimes(1);
	});

	it("suppresses the expiry action when the room is already finalizing", () => {
		const { room } = makeAbandonedRoom();
		const onExpire = jest.fn();

		room.startReconnectGrace(onExpire);
		room.finalizing = true;

		jest.advanceTimersByTime(RECONNECT_GRACE_MS);
		expect(onExpire).not.toHaveBeenCalled();
	});

	it("a successful socket takeover cancels the grace before it can expire", () => {
		const { room, player } = makeAbandonedRoom();
		const onExpire = jest.fn();

		room.startReconnectGrace(onExpire);
		room.reconnect(player, new SocketStub());

		jest.advanceTimersByTime(RECONNECT_GRACE_MS * 2);
		expect(onExpire).not.toHaveBeenCalled();
	});
});
