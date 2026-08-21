import "reflect-metadata";

import EventEmitter from "events";
import { gunzipSync } from "node:zlib";

import { YGOProBanList } from "@ygopro/ban-list/domain/YGOProBanList";
import YGOProBanListMemoryRepository from "@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { MessageRepositoryMock } from "@test-support/mocks/MessageRepositoryMock";
import { GameOverDomainEvent } from "@shared/room/domain/match/domain/domain-events/GameOverDomainEvent";
import { DuelRecord } from "./DuelRecord";
import { type NostalgiaFormatId } from "./NostalgiaFormat";
import { YGOProRoom } from "./YGOProRoom";
import { EvrpSerializer } from "./replay/EvrpSerializer";

const OCG_1103_HASH = 3_163_254_096;
const OCG_1109_HASH = 3_935_183_130;

function createBanList(name: string, hash: number): YGOProBanList {
	const banList = new YGOProBanList();
	banList.setName(name);
	banList.setHash(hash);
	return banList;
}

function createRoom(formatId: NostalgiaFormatId, banListHash: number): YGOProRoom {
	return YGOProRoom.createNostalgia({
		id: 1,
		formatId,
		roomId: "1001",
		logger: new LoggerMock(),
		emitter: new EventEmitter(),
		createdBySocketId: "socket-id",
		messageRepository: new MessageRepositoryMock(),
		banListHash,
	});
}

const replayEnvelope = (room: YGOProRoom): { meta: { hostInfo: { lflist: number } } } =>
	JSON.parse(
		gunzipSync(
			EvrpSerializer.serialize({ players: room.players, hostInfo: room.hostInfo }, [
				new DuelRecord([], [], false),
			]),
		).toString("utf8"),
	);

const gameOverEvent = (room: YGOProRoom): GameOverDomainEvent =>
	new GameOverDomainEvent({
		bestOf: room.bestOf,
		players: room.matchPlayersHistory,
		date: new Date(),
		banListHash: room.banListHash,
		banListName: room.banListName ?? "N/A",
		ranked: room.ranked,
		formatId: room.formatId,
		externalRoomId: room.externalRoomId,
		admissionKey: room.admissionKey,
	});

describe("YGOProRoom ban-list hash and name consistency", () => {
	beforeEach(() => {
		YGOProBanListMemoryRepository.replaceAll([
			createBanList("OCG 1103", OCG_1103_HASH),
			createBanList("OCG 1109", OCG_1109_HASH),
		]);
	});

	afterEach(() => {
		YGOProBanListMemoryRepository.replaceAll([]);
	});

	it.each([
		["1103", "OCG 1103", OCG_1103_HASH],
		["1109", "OCG 1109", OCG_1109_HASH],
	] as const)("keeps %s hash and name consistent across room, replay and event", (formatId, name, hash) => {
		const room = createRoom(formatId, hash);

		expect(room.banListName).toBe(name);
		expect(room.toRoomListDTO().banlist).toBe(name);
		expect(room.hostInfo.lflist).toBe(hash);
		expect(replayEnvelope(room).meta.hostInfo.lflist).toBe(hash);

		const event = gameOverEvent(room);
		expect(event.data.banListName).toBe(name);
		expect(event.data.banListHash).toBe(hash);
		expect(event.data.formatId).toBe(formatId);
		expect(YGOProBanListMemoryRepository.findByHash(hash)?.name).toBe(name);
	});

	it("falls back to N/A when the selected list is unavailable", () => {
		YGOProBanListMemoryRepository.replaceAll([]);
		const event = gameOverEvent(createRoom("1109", OCG_1109_HASH));

		expect(event.data.banListName).toBe("N/A");
		expect(event.data.banListHash).toBe(OCG_1109_HASH);
	});
});
