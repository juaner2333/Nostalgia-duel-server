import { EventEmitter } from "stream";

import { RoomLeague } from "@shared/room/admission/domain/RoomLeague";

import { MATCHMAKING_FORMATS } from "../domain/QueueEntry";
import YGOProRoomList from "../../room/infrastructure/YGOProRoomList";
import { createMatchmakingRoom } from "./MatchmakingRoomFactory";

const makeLogger = () =>
	({
		child: jest.fn().mockReturnThis(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		debug: jest.fn(),
	}) as never;

const resources = {
	getBanListHash: (formatId: "1103" | "1109") => (formatId === "1103" ? 1103 : 1109),
};

const clearRooms = () => {
	for (const room of [...YGOProRoomList.getRooms()]) {
		YGOProRoomList.deleteRoom(room);
	}
};

describe("createMatchmakingRoom", () => {
	beforeEach(clearRooms);
	afterEach(clearRooms);

	it.each(MATCHMAKING_FORMATS)("creates a fixed %s ranked MATCH room", (format) => {
		const { room, roomPassword } = createMatchmakingRoom({
			format,
			rankedOverride: true,
			logger: makeLogger(),
			emitter: new EventEmitter(),
			resources,
		});

		expect(room.league).toBe(RoomLeague.Verified);
		expect(room.formatId).toBe(format);
		expect(room.hostInfo).toMatchObject({ rule: 0, duel_rule: 2, best_of: 3 });
		expect(room.isMatch).toBe(true);
		expect(room.password).toBe("");
		expect(roomPassword).toBe(room.admissionKey);
		expect(YGOProRoomList.findByAdmissionKey(roomPassword)).toBe(room);
	});

	it("keeps bot rooms in the same fixed MATCH rules", () => {
		const { room } = createMatchmakingRoom({
			format: "1109",
			rankedOverride: false,
			logger: makeLogger(),
			emitter: new EventEmitter(),
			resources,
		});

		expect(room.league).toBe(RoomLeague.Casual);
		expect(room.bestOf).toBe(3);
		expect(room.hostInfo.rule).toBe(0);
	});

	it.each(
		MATCHMAKING_FORMATS,
	)("produces a numeric %s room identifier that fits CTOS_JOIN_GAME", (format) => {
		for (let i = 0; i < 50; i++) {
			const { roomPassword } = createMatchmakingRoom({
				format,
				rankedOverride: true,
				logger: makeLogger(),
				emitter: new EventEmitter(),
				resources,
			});

			expect(roomPassword).toMatch(new RegExp(`^${format}#\\d+$`));
			expect(roomPassword.length).toBeLessThanOrEqual(20);
		}
	});

	it("creates distinct admission keys for distinct pairs", () => {
		const input = {
			format: "1109" as const,
			rankedOverride: true,
			logger: makeLogger(),
			emitter: new EventEmitter(),
			resources,
		};

		const first = createMatchmakingRoom(input);
		const second = createMatchmakingRoom(input);

		expect(first.roomPassword).not.toBe(second.roomPassword);
		expect(first.room.name).not.toBe(second.room.name);
	});

	it("fails without the fixed format ban-list hash", () => {
		expect(() =>
			createMatchmakingRoom({
				format: "1103",
				rankedOverride: true,
				logger: makeLogger(),
				emitter: new EventEmitter(),
				resources: { getBanListHash: () => null },
			}),
		).toThrow("Nostalgia ban list is unavailable");
	});
});
