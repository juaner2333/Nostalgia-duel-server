import "reflect-metadata";

import { gunzipSync } from "node:zlib";

import { YGOProRoomMother } from "@test-support/mothers/room/YGOProRoomMother";
import YGOProBanListMemoryRepository from "@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository";
import { YGOProBanList } from "@ygopro/ban-list/domain/YGOProBanList";
import { GameOverDomainEvent } from "@shared/room/domain/match/domain/domain-events/GameOverDomainEvent";
import { DuelRecord } from "./DuelRecord";
import { EvrpSerializer } from "./replay/EvrpSerializer";

// Same content hashes YGOProBanListLoader.test.ts pins for its fixtures.
const NORMAL_HASH = 3948153423;
const GENESYS_HASH = 342330484;

function createBanList(name: string, hash: number): YGOProBanList {
	const banList = new YGOProBanList();
	banList.setName(name);
	banList.setHash(hash);
	return banList;
}

const replayEnvelope = (
	room: ReturnType<typeof YGOProRoomMother.create>,
): { meta: { hostInfo: { lflist: number } } } =>
	JSON.parse(
		gunzipSync(
			EvrpSerializer.serialize({ players: room.players, hostInfo: room.hostInfo }, [
				new DuelRecord([], [], false),
			]),
		).toString("utf8"),
	);

/** Mirrors YGOProDuelingState.dispatchGameOverDomainEvent field-for-field. */
const gameOverEvent = (room: ReturnType<typeof YGOProRoomMother.create>): GameOverDomainEvent =>
	new GameOverDomainEvent({
		bestOf: room.bestOf,
		players: room.matchPlayersHistory,
		date: new Date(),
		banListHash: room.banListHash,
		banListName: room.banListName ?? "N/A",
		ranked: room.ranked,
	});

describe("YGOProRoom ban-list hash and name consistency", () => {
	beforeEach(() => {
		YGOProBanListMemoryRepository.replaceAll([
			createBanList("2026.01 OCG", NORMAL_HASH),
			createBanList("Genesys", GENESYS_HASH),
		]);
	});

	afterEach(() => {
		YGOProBanListMemoryRepository.replaceAll([]);
	});

	it("exposes one consistent hash and name for a normal list across room display, replay metadata and the game-over event", () => {
		const room = YGOProRoomMother.create({ command: "m#123" });

		expect(room.banListName).toBe("2026.01 OCG");
		expect(room.toRoomListDTO().banlist).toBe("2026.01 OCG");
		expect(room.hostInfo.lflist).toBe(NORMAL_HASH);
		expect(replayEnvelope(room).meta.hostInfo.lflist).toBe(NORMAL_HASH);

		const event = gameOverEvent(room);
		expect(event.data.banListName).toBe("2026.01 OCG");
		expect(event.data.banListHash).toBe(NORMAL_HASH);

		expect(YGOProBanListMemoryRepository.findByHash(NORMAL_HASH)?.name).toBe("2026.01 OCG");
	});

	it("exposes one consistent hash and name for the Genesys points list", () => {
		const room = YGOProRoomMother.create({ command: "genesys#123" });

		expect(room.banListName).toBe("Genesys");
		expect(room.toRoomListDTO().banlist).toBe("Genesys");
		expect(room.hostInfo.lflist).toBe(GENESYS_HASH);
		expect(replayEnvelope(room).meta.hostInfo.lflist).toBe(GENESYS_HASH);
		expect(room.hostInfo.max_deck_points).toBe(100);

		const event = gameOverEvent(room);
		expect(event.data.banListName).toBe("Genesys");
		expect(event.data.banListHash).toBe(GENESYS_HASH);

		expect(YGOProBanListMemoryRepository.findByHash(GENESYS_HASH)?.name).toBe("Genesys");
	});

	it("falls back to N/A and zero in the game-over event when no list matches", () => {
		YGOProBanListMemoryRepository.replaceAll([]);

		const room = YGOProRoomMother.create({ command: "m#123" });

		const event = gameOverEvent(room);
		expect(event.data.banListName).toBe("N/A");
		expect(event.data.banListHash).toBe(0);
	});
});
