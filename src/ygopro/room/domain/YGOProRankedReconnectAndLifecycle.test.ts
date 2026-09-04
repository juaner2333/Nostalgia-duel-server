import { EventEmitter } from "events";

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

import { YGOProClient } from "@ygopro/client/domain/YGOProClient";
import { Team } from "@shared/room/Team";
import { ISocket, SocketTransport } from "@shared/socket/domain/ISocket";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { MessageRepositoryMock } from "@test-support/mocks/MessageRepositoryMock";
import { YGOProRoom } from "./YGOProRoom";
import { RankedRoomRegistry } from "../ranked/domain/RankedRoomRegistry";
import { findReconnectingPlayer } from "@shared/room/domain/findReconnectingPlayer";
import { DuelState } from "@shared/room/domain/YgoRoom";
import { EventBus } from "@shared/event-bus/EventBus";
import { container } from "@shared/dependency-injection";
import { GameOverDomainEvent } from "@shared/room/domain/match/domain/domain-events/GameOverDomainEvent";
import YGOProRoomList from "../infrastructure/YGOProRoomList";
import { YGOProDisconnectHandler } from "../application/YGOProDisconnectHandler";

jest.useFakeTimers();

class FakeSocket implements ISocket {
	id = "socket-" + Math.random().toString(36).substring(7);
	roomId?: number;
	resolvedUserId?: string;
	readonly transport: SocketTransport = "tcp";
	remoteAddress: string | undefined = "127.0.0.1";
	closed = false;
	readonly sends: Buffer[] = [];
	private closeCallback?: () => void;

	send(message: Buffer): void {
		this.sends.push(message);
	}

	onMessage(_callback: (message: Buffer) => void): void {
		// noop
	}

	onClose(callback: () => void): void {
		this.closeCallback = callback;
	}

	close(): void {
		this.closed = true;
		this.closeCallback?.();
	}

	destroy(): void {
		this.closed = true;
		this.closeCallback = undefined;
	}

	removeAllListeners(): void {
		this.closeCallback = undefined;
	}
}

const makeRankedRoom = (formatId: "1103" | "1109" = "1109") => {
	const emitter = new EventEmitter();
	const room = YGOProRoom.createDirectRanked({
		id: Math.floor(Math.random() * 100000),
		formatId,
		logger: new LoggerMock(),
		emitter,
		createdBySocketId: "creator-socket",
		messageRepository: new MessageRepositoryMock(),
		banListHash: 1109,
		eventBus: container.get(EventBus),
	});
	YGOProRoomList.addRoom(room);
	return room;
};

const addPlayerToRoom = (room: YGOProRoom, name: string, userId: string, position: number) => {
	const socket = new FakeSocket();
	socket.resolvedUserId = userId;
	const player = new YGOProClient({
		name,
		socket,
		logger: new LoggerMock(),
		position,
		host: position === 0,
		id: userId,
		team: position === 0 ? Team.PLAYER : Team.OPPONENT,
		room,
	});
	room.addPlayerUnsafe(player);
	RankedRoomRegistry.getInstance().recordOccupancy(userId, room.id, room.formatId);
	return { player, socket };
};

describe("YGOPro Ranked Reconnect and Lifecycle", () => {
	beforeEach(() => {
		jest.clearAllTimers();
		RankedRoomRegistry.getInstance().clear();
		for (const r of [...YGOProRoomList.getRooms()]) {
			YGOProRoomList.deleteRoom(r);
		}
	});

	afterEach(() => {
		jest.clearAllTimers();
		RankedRoomRegistry.getInstance().clear();
		for (const r of [...YGOProRoomList.getRooms()]) {
			YGOProRoomList.deleteRoom(r);
		}
	});

	describe("findReconnectingPlayer with userId matching", () => {
		it("allows seat takeover when userId matches even from a different IP", () => {
			const room = makeRankedRoom();
			const { player } = addPlayerToRoom(room, "Yugi", "user-1", 0);

			const result = findReconnectingPlayer({
				players: room.players,
				name: "Yugi",
				transport: "tcp",
				ranked: true,
				userId: "user-1",
			});

			expect(result.outcome).toBe("takeover");
			if (result.outcome === "takeover") {
				expect(result.player).toBe(player);
			}
		});

		it("rejects seat takeover when another user attempts to claim the same nickname", () => {
			const room = makeRankedRoom();
			addPlayerToRoom(room, "Yugi", "user-1", 0);

			const result = findReconnectingPlayer({
				players: room.players,
				name: "Yugi",
				transport: "tcp",
				ranked: true,
				userId: "user-imposter",
			});

			expect(result.outcome).toBe("rejected");
		});
	});

	describe("Ranked 90-second single player timeout & forfeit", () => {
		it("forfeits the match and dispatches GameOverDomainEvent when single player disconnects and times out", () => {
			const room = makeRankedRoom();
			const { player: p1, socket: s1 } = addPlayerToRoom(room, "Player1", "user-1", 0);
			const { player: p2, socket: s2 } = addPlayerToRoom(room, "Player2", "user-2", 1);

			room.createMatch();
			// simulate DUELING state
			(room as any)._state = DuelState.DUELING;

			const publishedEvents: GameOverDomainEvent[] = [];
			const eventBus = container.get(EventBus);
			const subscriber = {
				handle: (event: unknown) => {
					publishedEvents.push(event as GameOverDomainEvent);
				},
			};
			eventBus.subscribe(GameOverDomainEvent.DOMAIN_EVENT, subscriber);

			// Player 1 disconnects
			s1.close();
			const finder = { run: () => room } as any;
			const handler1 = new YGOProDisconnectHandler(s1, finder);
			handler1.run();

			// 89 seconds: still waiting
			jest.advanceTimersByTime(89_000);
			expect(publishedEvents).toHaveLength(0);
			expect(room.finalizing).toBe(false);

			// 90 seconds expires
			jest.advanceTimersByTime(1_000);

			// Match should be forfeited, GameOverDomainEvent dispatched
			expect(publishedEvents).toHaveLength(1);
			expect(publishedEvents[0].data.formatId).toBe("1109");
			expect(publishedEvents[0].data.ranked).toBe(true);

			// Registry occupancies cleared
			expect(RankedRoomRegistry.getInstance().getOccupancy("user-1")).toBeNull();
			expect(RankedRoomRegistry.getInstance().getOccupancy("user-2")).toBeNull();

			// Room deleted from room list
			expect(YGOProRoomList.findById(room.id)).toBeNull();
		});

		it("cancels single player timeout when player reconnects within 90 seconds", () => {
			const room = makeRankedRoom();
			const { player: p1, socket: s1 } = addPlayerToRoom(room, "Player1", "user-1", 0);
			const { player: p2, socket: s2 } = addPlayerToRoom(room, "Player2", "user-2", 1);

			room.createMatch();
			(room as any)._state = DuelState.DUELING;

			s1.close();
			const finder = { run: () => room } as any;
			new YGOProDisconnectHandler(s1, finder).run();

			// Reconnect at 50 seconds
			jest.advanceTimersByTime(50_000);
			const newSocket = new FakeSocket();
			newSocket.resolvedUserId = "user-1";
			room.reconnect(p1, newSocket);

			// Advance past 90 seconds
			jest.advanceTimersByTime(60_000);

			// Room is not finalized
			expect(room.finalizing).toBe(false);
			expect(p1.socket).toBe(newSocket);
		});

		it("does not write score when both players disconnect and 90s expires", () => {
			const room = makeRankedRoom();
			const { player: p1, socket: s1 } = addPlayerToRoom(room, "Player1", "user-1", 0);
			const { player: p2, socket: s2 } = addPlayerToRoom(room, "Player2", "user-2", 1);

			room.createMatch();
			(room as any)._state = DuelState.DUELING;

			const publishedEvents: GameOverDomainEvent[] = [];
			const eventBus = container.get(EventBus);
			const subscriber = {
				handle: (event: unknown) => {
					publishedEvents.push(event as GameOverDomainEvent);
				},
			};
			eventBus.subscribe(GameOverDomainEvent.DOMAIN_EVENT, subscriber);

			// Both disconnect
			s1.close();
			s2.close();
			const finder = { run: () => room } as any;
			new YGOProDisconnectHandler(s1, finder).run();
			new YGOProDisconnectHandler(s2, finder).run();

			jest.advanceTimersByTime(90_000);

			// No event dispatched when both abandon
			expect(publishedEvents).toHaveLength(0);
			expect(RankedRoomRegistry.getInstance().getOccupancy("user-1")).toBeNull();
			expect(RankedRoomRegistry.getInstance().getOccupancy("user-2")).toBeNull();
		});

		it("forfeits second player when both players disconnect but only first player reconnects", () => {
			const room = makeRankedRoom();
			const { player: p1, socket: s1 } = addPlayerToRoom(room, "Player1", "user-1", 0);
			const { player: p2, socket: s2 } = addPlayerToRoom(room, "Player2", "user-2", 1);

			room.createMatch();
			(room as any)._state = DuelState.DUELING;

			const publishedEvents: GameOverDomainEvent[] = [];
			const eventBus = container.get(EventBus);
			const subscriber = {
				handle: (event: unknown) => {
					publishedEvents.push(event as GameOverDomainEvent);
				},
			};
			eventBus.subscribe(GameOverDomainEvent.DOMAIN_EVENT, subscriber);

			// Both disconnect
			s1.close();
			s2.close();
			const finder = { run: () => room } as any;
			new YGOProDisconnectHandler(s1, finder).run();
			new YGOProDisconnectHandler(s2, finder).run();

			// Player 1 reconnects at 30 seconds
			jest.advanceTimersByTime(30_000);
			const newSocket = new FakeSocket();
			newSocket.resolvedUserId = "user-1";
			room.reconnect(p1, newSocket);

			// Advance past player 2's 90-second disconnect timeout (another 65 seconds)
			jest.advanceTimersByTime(65_000);

			// Player 2's disconnect timer must have fired, forfeiting match to Player 1
			expect(publishedEvents).toHaveLength(1);
			const event = publishedEvents[0];
			expect(event.data.ranked).toBe(true);
			const winner = event.data.players.find((p) => p.winner);
			expect(winner?.name).toBe("Player1");
			expect(room.finalizing).toBe(true);
		});
	});
});
