import "reflect-metadata";

import EventEmitter from "events";
import { container } from "src/shared/dependency-injection";
import { EventBus } from "src/shared/event-bus/EventBus";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { MessageRepositoryMock } from "@test-support/mocks/MessageRepositoryMock";
import { GameOverDomainEvent } from "@shared/room/domain/match/domain/domain-events/GameOverDomainEvent";
import { Deck } from "@shared/deck/domain/Deck";
import { Card } from "@shared/card/domain/Card";
import { Team } from "@shared/room/Team";
import { ISocket } from "@shared/socket/domain/ISocket";
import { YGOProClient } from "../../client/domain/YGOProClient";
import { YGOProRoom } from "./YGOProRoom";
import YGOProRoomList from "../infrastructure/YGOProRoomList";
import { RankedRoomRegistry } from "../ranked/domain/RankedRoomRegistry";

class FakeSocket implements ISocket {
	readonly transport = "tcp" as const;
	id = `socket-${Math.random()}`;
	closed = false;
	remoteAddress = "127.0.0.1";
	resolvedUserId?: string;
	private closeCallback?: () => void;

	send(): void {
		// Mock implementation
	}
	onMessage(): void {
		// Mock implementation
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
	}
	removeAllListeners(): void {
		// Mock implementation
	}
}

function makeCard(code: number): Card {
	return new Card({
		alias: "0",
		code: String(code),
		type: 0x11,
		category: 0,
		variant: 1,
	});
}

function makeDeck(mainCodes: number[]): Deck {
	return new Deck({
		main: mainCodes.map(makeCard),
		extra: [],
		side: [],
		banList: {} as any,
		deckRules: {} as any,
	});
}

function makeRankedRoom(formatId: "1103" | "1109" = "1109"): YGOProRoom {
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
}

function addPlayer(room: YGOProRoom, name: string, userId: string, position: number) {
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
	player.setDeck(makeDeck([10001, 10002]));
	room.addPlayerUnsafe(player);
	return player;
}

describe("YGOProRoom Duel Seat Freezing and Lifecycle", () => {
	beforeEach(() => {
		RankedRoomRegistry.getInstance().clear();
		for (const r of [...YGOProRoomList.getRooms()]) {
			YGOProRoomList.deleteRoom(r);
		}
	});

	it("freezes G1 actual starter, complementary isFirst values, and reflects them in match history", () => {
		const room = makeRankedRoom("1109");
		addPlayer(room, "player1", "u1", 0);
		addPlayer(room, "player2", "u2", 1);
		room.createMatch();

		// G1 starts: player1 goes first
		room.recordDuelStart(1, "player1");
		room.duelWinner(0); // player1 wins

		const history = room.matchPlayersHistory;
		expect(history[0].games[0].duelIndex).toBe(1);
		expect(history[0].games[0].isFirst).toBe(true);
		expect(history[1].games[0].duelIndex).toBe(1);
		expect(history[1].games[0].isFirst).toBe(false);
	});

	it("records G2/G3 side switches with alternate first player", () => {
		const room = makeRankedRoom("1109");
		addPlayer(room, "player1", "u1", 0);
		addPlayer(room, "player2", "u2", 1);
		room.createMatch();

		// G1: player1 first
		room.recordDuelStart(1, "player1");
		room.duelWinner(0);

		// G2: player2 first
		room.recordDuelStart(2, "player2");
		room.duelWinner(1);

		// G3: player1 first
		room.recordDuelStart(3, "player1");
		room.duelWinner(0);

		const history = room.matchPlayersHistory;
		// G1
		expect(history[0].games[0].duelIndex).toBe(1);
		expect(history[0].games[0].isFirst).toBe(true);
		expect(history[1].games[0].duelIndex).toBe(1);
		expect(history[1].games[0].isFirst).toBe(false);

		// G2
		expect(history[0].games[1].duelIndex).toBe(2);
		expect(history[0].games[1].isFirst).toBe(false);
		expect(history[1].games[1].duelIndex).toBe(2);
		expect(history[1].games[1].isFirst).toBe(true);

		// G3
		expect(history[0].games[2].duelIndex).toBe(3);
		expect(history[0].games[2].isFirst).toBe(true);
		expect(history[1].games[2].duelIndex).toBe(3);
		expect(history[1].games[2].isFirst).toBe(false);
	});

	it("leaves duelIndex and isFirst as null for forfeited match without real G1", () => {
		const room = makeRankedRoom("1109");
		addPlayer(room, "player1", "u1", 0);
		const p2 = addPlayer(room, "player2", "u2", 1);
		room.createMatch();

		const publishedEvents: GameOverDomainEvent[] = [];
		const eventBus = container.get(EventBus);
		eventBus.subscribe(GameOverDomainEvent.DOMAIN_EVENT, {
			handle: (event: GameOverDomainEvent) => {
				publishedEvents.push(event);
				return Promise.resolve();
			},
		});

		// Player 2 forfeits before any duel start
		room.forfeitMatch(p2);

		expect(publishedEvents).toHaveLength(1);
		const players = publishedEvents[0].data.players;
		expect(players[0].games).toHaveLength(2);
		expect(players[0].games[0].duelIndex).toBeNull();
		expect(players[0].games[0].isFirst).toBeNull();
		expect(players[0].games[1].duelIndex).toBeNull();
		expect(players[0].games[1].isFirst).toBeNull();
		expect(players[1].games[0].duelIndex).toBeNull();
		expect(players[1].games[0].isFirst).toBeNull();
		expect(players[1].games[1].duelIndex).toBeNull();
		expect(players[1].games[1].isFirst).toBeNull();
	});

	it("preserves G1 seat facts when G1 started, while unstarted forfeited G2 has null", () => {
		const room = makeRankedRoom("1109");
		addPlayer(room, "player1", "u1", 0);
		const p2 = addPlayer(room, "player2", "u2", 1);
		room.createMatch();

		const publishedEvents: GameOverDomainEvent[] = [];
		const eventBus = container.get(EventBus);
		eventBus.subscribe(GameOverDomainEvent.DOMAIN_EVENT, {
			handle: (event: GameOverDomainEvent) => {
				publishedEvents.push(event);
				return Promise.resolve();
			},
		});

		// G1 starts with player1 first
		room.recordDuelStart(1, "player1");
		// Player 2 disconnects and forfeits during G1
		room.forfeitMatch(p2);

		expect(publishedEvents).toHaveLength(1);
		const players = publishedEvents[0].data.players;
		expect(players[0].games).toHaveLength(2);

		// G1 was active when forfeit occurred
		expect(players[0].games[0].duelIndex).toBe(1);
		expect(players[0].games[0].isFirst).toBe(true);
		expect(players[1].games[0].duelIndex).toBe(1);
		expect(players[1].games[0].isFirst).toBe(false);

		// G2 was never started -> null
		expect(players[0].games[1].duelIndex).toBeNull();
		expect(players[0].games[1].isFirst).toBeNull();
		expect(players[1].games[1].duelIndex).toBeNull();
		expect(players[1].games[1].isFirst).toBeNull();
	});

	it("works equivalently for 1103 ranked rooms without regression", () => {
		const room = makeRankedRoom("1103");
		addPlayer(room, "player1", "u1", 0);
		addPlayer(room, "player2", "u2", 1);
		room.createMatch();

		room.recordDuelStart(1, "player2");
		room.duelWinner(1);

		const history = room.matchPlayersHistory;
		expect(history[0].games[0].duelIndex).toBe(1);
		expect(history[0].games[0].isFirst).toBe(false);
		expect(history[1].games[0].duelIndex).toBe(1);
		expect(history[1].games[0].isFirst).toBe(true);
	});
});
