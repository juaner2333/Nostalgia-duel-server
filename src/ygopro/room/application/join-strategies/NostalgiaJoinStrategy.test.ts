import { EventEmitter } from "node:events";
import { YGOProRoom } from "../../domain/YGOProRoom";
import YGOProRoomList from "../../infrastructure/YGOProRoomList";
import { JoinContext } from "./JoinStrategy";
import { NostalgiaJoinStrategy, parseNostalgiaRoomId } from "./NostalgiaJoinStrategy";

const formatResources = {
	getBanListHash: (formatId: "1103" | "1109") => Number(formatId),
};

function makeContext(rawPass: string): JoinContext {
	return {
		rawPass,
		command: rawPass.split("#")[0],
		password: rawPass.split("#")[1] ?? "",
		playerInfo: {} as JoinContext["playerInfo"],
		socket: { id: "socket-1" } as JoinContext["socket"],
		socketId: "socket-1",
		eventEmitter: new EventEmitter(),
		messageRepository: {} as JoinContext["messageRepository"],
		logger: { info: jest.fn() } as unknown as JoinContext["logger"],
		message: {} as JoinContext["message"],
	};
}

describe("NostalgiaJoinStrategy", () => {
	afterEach(() => {
		jest.restoreAllMocks();
		for (const room of [...YGOProRoomList.getRooms()]) {
			YGOProRoomList.deleteRoom(room);
		}
	});

	it("parses valid environment room IDs and rejects malformed values", () => {
		expect(parseNostalgiaRoomId("1103#1001")).toEqual({ formatId: "1103", roomId: "1001" });
		expect(parseNostalgiaRoomId("1109#1001")).toEqual({ formatId: "1109", roomId: "1001" });
		for (const value of [
			"1104#1001",
			"1103#",
			"1109#abc",
			"1109#1001#secret",
			"1103#123456789012345678",
		]) {
			expect(() => parseNostalgiaRoomId(value)).toThrow();
		}
	});

	it("creates and admits a passwordless room with the format-room composite key", async () => {
		const room = { emit: jest.fn(), waiting: jest.fn() } as unknown as YGOProRoom;
		const create = jest.spyOn(YGOProRoom, "createNostalgia").mockReturnValue(room);
		const strategy = new NostalgiaJoinStrategy(formatResources);
		const context = makeContext("1103#1001");

		expect(strategy.matches(context)).toBe(true);
		await strategy.handle(context);

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({ formatId: "1103", roomId: "1001", rankedOverride: undefined }),
		);
		expect(room.waiting).toHaveBeenCalledTimes(1);
		expect(room.emit).toHaveBeenCalledWith("JOIN", context.message, context.socket);
	});

	it("keeps same-number rooms isolated by format", async () => {
		const room1103 = {
			formatId: "1103",
			externalRoomId: "1001",
			admissionKey: "1103#1001",
			emit: jest.fn(),
		} as unknown as YGOProRoom;
		YGOProRoomList.addRoom(room1103);
		const create = jest.spyOn(YGOProRoom, "createNostalgia").mockReturnValue({
			emit: jest.fn(),
			waiting: jest.fn(),
		} as unknown as YGOProRoom);
		const strategy = new NostalgiaJoinStrategy(formatResources);

		await strategy.handle(makeContext("1109#1001"));

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({ formatId: "1109", roomId: "1001" }),
		);
		expect(room1103.emit).not.toHaveBeenCalled();
	});

	it("handles recognized malformed nostalgia input instead of falling back", () => {
		const strategy = new NostalgiaJoinStrategy(formatResources);

		expect(strategy.matches(makeContext("1103#"))).toBe(true);
		expect(strategy.matches(makeContext("1104#1001"))).toBe(true);
		expect(strategy.matches(makeContext("ordinary-room"))).toBe(false);
	});
});
