import { randomUUID } from "crypto";

import { YGOProClient } from "../../client/domain/YGOProClient";
import { Team } from "@shared/room/Team";
import { ISocket, SocketTransport } from "@shared/socket/domain/ISocket";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { YGOProRoomMother } from "@test-support/mothers/room/YGOProRoomMother";

import { YGOProRoom } from "./YGOProRoom";

/**
 * Minimal ISocket whose close/dispose lifecycle mirrors the TCP adapter:
 * `destroy()` first removes registered callbacks, then reports closed. Lets a
 * test assert that a replaced (half-open) socket can no longer trigger the
 * disconnect handler after the room detaches it.
 */
class FakeSocket implements ISocket {
	id = randomUUID();
	roomId?: number;
	resolvedUserId?: string;
	readonly transport: SocketTransport = "tcp";
	remoteAddress = "127.0.0.1";
	closed = false;
	readonly sends: Buffer[] = [];
	removed = false;
	destroyed = false;
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
		this.destroyed = true;
		this.closed = true;
	}

	removeAllListeners(): void {
		this.removed = true;
		this.closeCallback = undefined;
	}

	/** Test-only: a late `close` event from the (now discarded) connection. */
	simulateClose(): void {
		this.closed = true;
		const cb = this.closeCallback;
		this.closeCallback = undefined;
		cb?.();
	}
}

const makeRoomWithPlayer = (): {
	room: YGOProRoom;
	player: YGOProClient;
	oldSocket: FakeSocket;
	cleanup: { called: boolean };
} => {
	const room = YGOProRoomMother.create();
	const oldSocket = new FakeSocket();
	const player = new YGOProClient({
		name: "Jaden",
		socket: oldSocket,
		logger: new LoggerMock(),
		position: 0,
		host: true,
		id: null,
		team: Team.PLAYER,
		room,
	});
	room.addPlayerUnsafe(player);

	// Mirror the TCP server: the disconnect handler is registered as the close
	// callback of the client's socket.
	const cleanup = { called: false };
	oldSocket.onClose(() => {
		cleanup.called = true;
	});

	return { room, player, oldSocket, cleanup };
};

describe("YGOProRoom.reconnect — half-open TCP socket replacement", () => {
	it("detaches the old socket's room listeners and destroys the old connection", () => {
		const { room, player, oldSocket, cleanup } = makeRoomWithPlayer();
		const newSocket = new FakeSocket();

		room.reconnect(player, newSocket);

		// Old socket: room message + close callbacks removed, then disposed.
		expect(oldSocket.removed).toBe(true);
		expect(oldSocket.destroyed).toBe(true);
		// New socket is bound to the SAME player object.
		expect(player.socket).toBe(newSocket);
		// Seat identity (position/team/host) is untouched by the swap.
		expect(player.position).toBe(0);
		expect(player.team).toBe(Team.PLAYER);
		expect(player.host).toBe(true);
		expect(player.isReconnecting).toBe(true);
		// The reconnecting player gets the existing lobby/init frames resynced.
		expect(newSocket.sends.length).toBeGreaterThan(0);

		// A late close from the discarded old connection must not run the room
		// disconnect cleanup (its close callback was removed before destroy).
		oldSocket.simulateClose();
		expect(cleanup.called).toBe(false);
		expect(room.players).toHaveLength(1);
		expect(room.players[0].socket).toBe(newSocket);
	});

	it("leaves the seat unchanged and only the new socket can drive the player", () => {
		const { room, player, newSocket } = (() => {
			const { room, player, oldSocket } = makeRoomWithPlayer();
			const newSocket = new FakeSocket();
			room.reconnect(player, newSocket);
			return { room, player, newSocket };
		})();

		// Sanity: the replaced player is still present, on the same seat.
		expect(room.players).toHaveLength(1);
		expect(room.players[0]).toBe(player);
		expect(room.players[0].position).toBe(0);
	});

	it("is idempotent when the socket being attached is already the current one", () => {
		const { room, player, oldSocket } = makeRoomWithPlayer();
		const sendsBefore = oldSocket.sends.length;

		room.reconnect(player, oldSocket);

		// Same socket: never detached/destroyed, no double init broadcast.
		expect(oldSocket.destroyed).toBe(false);
		expect(player.socket).toBe(oldSocket);
		expect(oldSocket.sends.length).toBe(sendsBefore);
	});

	it("last join wins: consecutive qualified reconnects close every prior socket and only the latest drives the seat", () => {
		const { room, player, oldSocket } = makeRoomWithPlayer();
		const middle = new FakeSocket();
		const latest = new FakeSocket();

		room.reconnect(player, middle);
		room.reconnect(player, latest);

		// The replace chain is synchronous: the first new socket is itself torn
		// down by the second takeover.
		expect(oldSocket.destroyed).toBe(true);
		expect(middle.destroyed).toBe(true);
		expect(player.socket).toBe(latest);

		// Only the latest socket keeps receiving room commands for this player.
		const middleSendsAtLatest = middle.sends.length;
		const latestSendsAtStart = latest.sends.length;
		player.sendMessageToClient(Buffer.from([0x01]));
		player.sendMessageToClient(Buffer.from([0x02]));
		expect(latest.sends.length).toBe(latestSendsAtStart + 2);
		expect(middle.sends.length).toBe(middleSendsAtLatest);
	});
});
