import { EventEmitter } from "node:events";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { MessageRepositoryMock } from "@test-support/mocks/MessageRepositoryMock";
import { YGOProBanList } from "@ygopro/ban-list/domain/YGOProBanList";
import YGOProBanListMemoryRepository from "@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository";
import type { ISocket } from "@shared/socket/domain/ISocket";
import { YGOProRoom } from "./YGOProRoom";
import { DuelState } from "@shared/room/domain/YgoRoom";
import { YGOProClient } from "../../client/domain/YGOProClient";

function makeSocket(id: string): ISocket {
	return {
		id,
		transport: "tcp",
		send: jest.fn(),
		onMessage: jest.fn(),
		onClose: jest.fn(),
		close: jest.fn(),
		destroy: jest.fn(),
		remoteAddress: "127.0.0.1",
		closed: false,
		removeAllListeners: jest.fn(),
	};
}

describe("YGOProRankedNicknameMasking", () => {
	let messageRepo: MessageRepositoryMock;

	beforeEach(() => {
		YGOProBanListMemoryRepository.clear();
		const banList = new YGOProBanList();
		banList.setName("OCG 1109");
		banList.setHash(1109);
		YGOProBanListMemoryRepository.add(banList);

		messageRepo = new MessageRepositoryMock();
		messageRepo.playerEnterMessage = jest
			.fn()
			.mockImplementation((name: string, pos: number) => Buffer.from(`enter:${name}:${pos}`));
	});

	afterEach(() => {
		YGOProBanListMemoryRepository.clear();
	});

	function createRankedRoom(): YGOProRoom {
		const room = YGOProRoom.createDirectRanked({
			id: 100,
			formatId: "1109",
			logger: new LoggerMock(),
			emitter: new EventEmitter(),
			createdBySocketId: "socket-1",
			messageRepository: messageRepo,
			banListHash: 1109,
		});
		room.waiting();
		return room;
	}

	function createNormalRoom(): YGOProRoom {
		return YGOProRoom.createNostalgia({
			id: 200,
			formatId: "1109",
			roomId: "1001",
			logger: new LoggerMock(),
			emitter: new EventEmitter(),
			createdBySocketId: "socket-1",
			messageRepository: messageRepo,
			banListHash: 1109,
		});
	}

	it("masks opponent nickname as *** during ranked WAITING state, while player sees own real name", () => {
		const room = createRankedRoom();
		const sock1 = makeSocket("s1");
		const sock2 = makeSocket("s2");

		const p1 = room.createPlayerUnsafe(sock1, "RealAlice", "user-1")!;
		room.addPlayerUnsafe(p1);

		// Alice is alone, sees herself as RealAlice
		expect(messageRepo.playerEnterMessage).toHaveBeenCalledWith("RealAlice", 0);
		expect(p1.name).toBe("RealAlice");

		(messageRepo.playerEnterMessage as jest.Mock).mockClear();

		const p2 = room.createPlayerUnsafe(sock2, "RealBob", "user-2")!;
		room.addPlayerUnsafe(p2);

		// Alice should receive Bob's entry as ***
		expect(sock1.send).toHaveBeenCalledWith(Buffer.from("enter:***:1"));
		// Bob should receive Alice's entry as ***
		expect(sock2.send).toHaveBeenCalledWith(Buffer.from("enter:***:0"));
		// Bob should receive his own entry as RealBob
		expect(sock2.send).toHaveBeenCalledWith(Buffer.from("enter:RealBob:1"));

		// Internal names must stay real
		expect(p1.name).toBe("RealAlice");
		expect(p2.name).toBe("RealBob");
	});

	it("does not mask nicknames in normal (unranked) rooms", () => {
		const room = createNormalRoom();
		const sock1 = makeSocket("s1");
		const sock2 = makeSocket("s2");

		const p1 = room.createPlayerUnsafe(sock1, "Alice", "user-1")!;
		room.addPlayerUnsafe(p1);

		(messageRepo.playerEnterMessage as jest.Mock).mockClear();

		const p2 = room.createPlayerUnsafe(sock2, "Bob", "user-2")!;
		room.addPlayerUnsafe(p2);

		// In normal rooms, real names are sent
		expect(sock1.send).toHaveBeenCalledWith(Buffer.from("enter:Bob:1"));
		expect(sock2.send).toHaveBeenCalledWith(Buffer.from("enter:Alice:0"));
		expect(sock2.send).toHaveBeenCalledWith(Buffer.from("enter:Bob:1"));
	});

	it("revealRealPlayerNames refreshes real names to all players", () => {
		const room = createRankedRoom();
		const sock1 = makeSocket("s1");
		const sock2 = makeSocket("s2");

		const p1 = room.createPlayerUnsafe(sock1, "Alice", "user-1")!;
		room.addPlayerUnsafe(p1);
		const p2 = room.createPlayerUnsafe(sock2, "Bob", "user-2")!;
		room.addPlayerUnsafe(p2);

		(sock1.send as jest.Mock).mockClear();
		(sock2.send as jest.Mock).mockClear();

		room.revealRealPlayerNames();

		expect(sock1.send).toHaveBeenCalledWith(Buffer.from("enter:Alice:0"));
		expect(sock1.send).toHaveBeenCalledWith(Buffer.from("enter:Bob:1"));
		expect(sock2.send).toHaveBeenCalledWith(Buffer.from("enter:Alice:0"));
		expect(sock2.send).toHaveBeenCalledWith(Buffer.from("enter:Bob:1"));
	});

	it("formats :score response in Chinese as '比分：{玩家1} {比分1} - {比分2} {玩家2}'", () => {
		const room = createNormalRoom();
		const sock1 = makeSocket("s1");
		const sock2 = makeSocket("s2");

		const p1 = room.createPlayerUnsafe(sock1, "Alice", "user-1")!;
		room.addPlayerUnsafe(p1);
		const p2 = room.createPlayerUnsafe(sock2, "Bob", "user-2")!;
		room.addPlayerUnsafe(p2);

		room.createMatch();
		expect(room.score).toBe("比分：Alice 0 - 0 Bob");
	});

	describe("public room APIs (/api/getrooms and /api/rooms)", () => {
		it("masks users[].name in toPresentation() when ranked room is WAITING, reveals after WAITING", () => {
			const room = createRankedRoom();
			const sock1 = makeSocket("s1");
			const sock2 = makeSocket("s2");
			const p1 = room.createPlayerUnsafe(sock1, "Alice", "user-1")!;
			const p2 = room.createPlayerUnsafe(sock2, "Bob", "user-2")!;
			room.addPlayerUnsafe(p1);
			room.addPlayerUnsafe(p2);

			expect(room.duelState).toBe(DuelState.WAITING);
			const presWaiting = room.toPresentation();
			const usersWaiting = presWaiting.users as Array<{ name: string; pos: number }>;
			expect(usersWaiting[0].name).toBe("***");
			expect(usersWaiting[1].name).toBe("***");

			// Simulate state transition out of WAITING (e.g. RPS / DUELING)
			room.rps();
			expect(room.duelState).not.toBe(DuelState.WAITING);

			const presRps = room.toPresentation();
			const usersRps = presRps.users as Array<{ name: string; pos: number }>;
			expect(usersRps[0].name).toBe("Alice");
			expect(usersRps[1].name).toBe("Bob");
		});

		it("masks players[].name in toRoomListDTO() when ranked room is WAITING, reveals after WAITING", () => {
			const room = createRankedRoom();
			const sock1 = makeSocket("s1");
			const sock2 = makeSocket("s2");
			const p1 = room.createPlayerUnsafe(sock1, "Alice", "user-1")!;
			const p2 = room.createPlayerUnsafe(sock2, "Bob", "user-2")!;
			room.addPlayerUnsafe(p1);
			room.addPlayerUnsafe(p2);

			expect(room.duelState).toBe(DuelState.WAITING);
			const dtoWaiting = room.toRoomListDTO();
			const playersWaiting = dtoWaiting.players as Array<{ name: string; position: number }>;
			expect(playersWaiting[0].name).toBe("***");
			expect(playersWaiting[1].name).toBe("***");

			room.rps();
			expect(room.duelState).not.toBe(DuelState.WAITING);

			const dtoRps = room.toRoomListDTO();
			const playersRps = dtoRps.players as Array<{ name: string; position: number }>;
			expect(playersRps[0].name).toBe("Alice");
			expect(playersRps[1].name).toBe("Bob");
		});
	});
});
