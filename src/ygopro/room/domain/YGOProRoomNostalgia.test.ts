import { EventEmitter } from "node:events";
import { GameMode } from "ygopro-msg-encode";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { MessageRepositoryMock } from "@test-support/mocks/MessageRepositoryMock";
import { YGOProBanList } from "@ygopro/ban-list/domain/YGOProBanList";
import YGOProBanListMemoryRepository from "@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository";
import type { ISocket } from "@shared/socket/domain/ISocket";
import { DuelRecord } from "./DuelRecord";
import { YGOProRoom } from "./YGOProRoom";

function addBanList(formatId: "1103" | "1109", hash: number): void {
	const banList = new YGOProBanList();
	banList.setName(`OCG ${formatId}`);
	banList.setHash(hash);
	YGOProBanListMemoryRepository.add(banList);
}

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

describe("YGOProRoom nostalgia factory", () => {
	beforeEach(() => {
		YGOProBanListMemoryRepository.clear();
		addBanList("1103", 1103);
		addBanList("1109", 1109);
	});

	afterEach(() => {
		YGOProBanListMemoryRepository.clear();
	});

	it.each([
		"1103",
		"1109",
	] as const)("binds %s to its immutable OCG match resources", (formatId) => {
		const room = YGOProRoom.createNostalgia({
			id: 1,
			formatId,
			roomId: "1001",
			logger: new LoggerMock(),
			emitter: new EventEmitter(),
			createdBySocketId: "socket-1",
			messageRepository: new MessageRepositoryMock(),
			banListHash: Number(formatId),
		});

		expect(room.formatId).toBe(formatId);
		expect(room.externalRoomId).toBe("1001");
		expect(room.admissionKey).toBe(`${formatId}#1001`);
		expect(room.password).toBe("");
		expect(room.hostInfo).toMatchObject({
			rule: 0,
			duel_rule: 2,
			mode: GameMode.MATCH,
			start_lp: 8000,
			best_of: 3,
			time_limit: 300,
			lflist: Number(formatId),
		});
		expect(room.toRoomListDTO()).toMatchObject({
			formatId,
			externalRoomId: "1001",
			admissionKey: `${formatId}#1001`,
			banListHash: Number(formatId),
		});
		expect(room.toRealTimePresentation()).toMatchObject({
			formatId,
			externalRoomId: "1001",
			admissionKey: `${formatId}#1001`,
			banListHash: Number(formatId),
		});
	});

	it("keeps spectators and their disconnects isolated between same-number environments", async () => {
		const emitter1103 = new EventEmitter();
		const emitter1109 = new EventEmitter();
		const makeRoom = (formatId: "1103" | "1109", emitter: EventEmitter) =>
			YGOProRoom.createNostalgia({
				id: Number(formatId),
				formatId,
				roomId: "1001",
				logger: new LoggerMock(),
				emitter,
				createdBySocketId: `socket-${formatId}`,
				messageRepository: new MessageRepositoryMock(),
				banListHash: Number(formatId),
			});
		const room1103 = makeRoom("1103", emitter1103);
		const room1109 = makeRoom("1109", emitter1109);
		const socket1103 = makeSocket("observer-1103");
		const socket1109 = makeSocket("observer-1109");

		await room1103.admissionTarget(socket1103, { name: "Observer 1103" } as never).admitSpectator({
			kind: "guest",
			name: "Observer 1103",
		});
		await room1109.admissionTarget(socket1109, { name: "Observer 1109" } as never).admitSpectator({
			kind: "guest",
			name: "Observer 1109",
		});

		expect(room1103.spectators).toHaveLength(1);
		expect(room1109.spectators).toHaveLength(1);
		expect(room1103.players).toHaveLength(0);
		(socket1103.send as jest.Mock).mockClear();
		(socket1109.send as jest.Mock).mockClear();
		(room1103 as unknown as { broadcastToAll(message: Buffer): void }).broadcastToAll(
			Buffer.from("1103-only-message"),
		);
		expect(socket1103.send).toHaveBeenCalledWith(Buffer.from("1103-only-message"));
		expect(socket1109.send).not.toHaveBeenCalled();

		const ended1109 = jest.fn();
		emitter1109.on("ROOM_ENDED", ended1109);
		emitter1103.emit("ROOM_ENDED", room1103.id);
		expect(ended1109).not.toHaveBeenCalled();

		room1103.spectatorLeave(room1103.spectators[0] as never);
		expect(room1103.spectators).toHaveLength(0);
		expect(room1109.spectators).toHaveLength(1);
	});

	it("sends observers only their masked history and public live messages", async () => {
		const room = YGOProRoom.createNostalgia({
			id: 1103,
			formatId: "1103",
			roomId: "1001",
			logger: new LoggerMock(),
			emitter: new EventEmitter(),
			createdBySocketId: "socket-1103",
			messageRepository: new MessageRepositoryMock(),
			banListHash: 1103,
		});
		const socket = makeSocket("observer-1103");
		const spectator = room.createSpectatorUnsafe(socket, "Observer");
		room.addSpectatorUnsafe(spectator);
		(socket.send as jest.Mock).mockClear();

		const privateMessage = { observerView: jest.fn().mockReturnValue(undefined) };
		const publicFrame = Buffer.from("public-observer-frame");
		const playback = jest
			.spyOn(DuelRecord.prototype, "toPlayback")
			.mockImplementation(function* (map) {
				map?.(privateMessage as never);
				yield { toFullPayload: () => publicFrame } as never;
			});
		(room as unknown as { _currentDuelRecord: DuelRecord })._currentDuelRecord = new DuelRecord(
			[],
			[],
			false,
		);

		room.sendCurrentDuelHistoricalMessages(spectator);
		(room as unknown as { broadcastToAll(message: Buffer): void }).broadcastToAll(
			Buffer.from("public-live-message"),
		);

		expect(privateMessage.observerView).toHaveBeenCalledTimes(1);
		expect(socket.send).toHaveBeenCalledWith(publicFrame);
		expect(socket.send).toHaveBeenCalledWith(Buffer.from("public-live-message"));
		playback.mockRestore();
	});
});
