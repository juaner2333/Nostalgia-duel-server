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
	id = "fake-socket";
	closed = false;
	remoteAddress = "127.0.0.1";
	resolvedUserId?: string;
	private closeCallback?: () => void;

	send(): void {
		// mock implementation
	}
	onMessage(): void {
		// mock implementation
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
		// mock implementation
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

function makeDeck(mainCodes: number[], extraCodes: number[] = [], sideCodes: number[] = []): Deck {
	return new Deck({
		main: mainCodes.map(makeCard),
		extra: extraCodes.map(makeCard),
		side: sideCodes.map(makeCard),
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

function makeUnrankedRoom(formatId: "1103" | "1109" = "1109"): YGOProRoom {
	const emitter = new EventEmitter();
	const room = YGOProRoom.createNostalgia({
		id: Math.floor(Math.random() * 100000),
		formatId,
		roomId: "1001",
		logger: new LoggerMock(),
		emitter,
		createdBySocketId: "creator-socket",
		messageRepository: new MessageRepositoryMock(),
		banListHash: 1109,
	});
	YGOProRoomList.addRoom(room);
	return room;
}

function addPlayer(room: YGOProRoom, name: string, userId: string, position: number, deck: Deck) {
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
	player.setDeck(deck);
	room.addPlayerUnsafe(player);
	return player;
}

describe("YGOProRoom Initial Deck Snapshot", () => {
	beforeEach(() => {
		RankedRoomRegistry.getInstance().clear();
		for (const r of [...YGOProRoomList.getRooms()]) {
			YGOProRoomList.deleteRoom(r);
		}
	});

	afterEach(() => {
		RankedRoomRegistry.getInstance().clear();
		for (const r of [...YGOProRoomList.getRooms()]) {
			YGOProRoomList.deleteRoom(r);
		}
	});

	it("freezes initial deck snapshot once at match start in ranked room", () => {
		const room = makeRankedRoom("1109");
		const deck1 = makeDeck([10001, 10002], [20001], [30001]);
		const deck2 = makeDeck([10003, 10004], [20002], [30002]);

		const p1 = addPlayer(room, "player1", "u1", 0, deck1);
		const p2 = addPlayer(room, "player2", "u2", 1, deck2);

		room.createMatch();

		const history = room.matchPlayersHistory;
		expect(history).toHaveLength(2);
		expect(history[0].deck).toBeDefined();
		expect(history[0].deck?.mainCards).toEqual([10001, 10002]);
		expect(history[0].deck?.extraCards).toEqual([20001]);
		expect(history[0].deck?.sideCards).toEqual([30001]);

		expect(history[1].deck).toBeDefined();
		expect(history[1].deck?.mainCards).toEqual([10003, 10004]);
		expect(history[1].deck?.extraCards).toEqual([20002]);
		expect(history[1].deck?.sideCards).toEqual([30002]);

		// Side decking in G2/G3 does NOT alter the frozen snapshot
		const newDeck1 = makeDeck([99999, 88888], [77777], [66666]);
		room.setDecksToPlayerUnsafe(0, newDeck1);
		expect(p1.deck.main.map((c) => Number(c.code))).toEqual([99999, 88888]);

		// Verify snapshot remains intact
		const historyAfterSide = room.matchPlayersHistory;
		expect(historyAfterSide[0].deck?.mainCards).toEqual([10001, 10002]);
		expect(historyAfterSide[0].deck?.extraCards).toEqual([20001]);
		expect(historyAfterSide[0].deck?.sideCards).toEqual([30001]);
	});

	it("forfeitMatch publishes GameOverDomainEvent with the frozen snapshot", () => {
		const room = makeRankedRoom("1109");
		const deck1 = makeDeck([10001, 10002]);
		const deck2 = makeDeck([10003, 10004]);

		const p1 = addPlayer(room, "player1", "u1", 0, deck1);
		const p2 = addPlayer(room, "player2", "u2", 1, deck2);

		room.createMatch();

		const publishedEvents: GameOverDomainEvent[] = [];
		const eventBus = container.get(EventBus);
		eventBus.subscribe(GameOverDomainEvent.DOMAIN_EVENT, {
			handle: (event: GameOverDomainEvent) => {
				publishedEvents.push(event);
				return Promise.resolve();
			},
		});

		room.forfeitMatch(p2);

		expect(publishedEvents).toHaveLength(1);
		const event = publishedEvents[0];
		expect(event.data.players[0].deck?.mainCards).toEqual([10001, 10002]);
		expect(event.data.players[1].deck?.mainCards).toEqual([10003, 10004]);
	});

	it("does not produce snapshots for unranked match", () => {
		const room = makeUnrankedRoom("1109");
		const deck1 = makeDeck([10001, 10002]);
		const deck2 = makeDeck([10003, 10004]);

		addPlayer(room, "player1", "u1", 0, deck1);
		addPlayer(room, "player2", "u2", 1, deck2);

		room.createMatch();

		const history = room.matchPlayersHistory;
		expect(history).toHaveLength(2);
		expect(history[0].deck).toBeUndefined();
		expect(history[1].deck).toBeUndefined();
	});
});
