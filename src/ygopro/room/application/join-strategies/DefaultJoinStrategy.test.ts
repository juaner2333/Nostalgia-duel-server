import { EventEmitter } from "stream";

import { JoinContext } from "./JoinStrategy";
import { DefaultJoinStrategy } from "./DefaultJoinStrategy";
import YGOProRoomList from "../../infrastructure/YGOProRoomList";

const makeContext = (): JoinContext =>
	({
		rawPass: "legacy-room#secret",
		command: "legacy-room",
		password: "secret",
		socket: { destroy: jest.fn() },
		socketId: "socket-1",
		eventEmitter: new EventEmitter(),
		logger: { info: jest.fn() },
	}) as unknown as JoinContext;

describe("DefaultJoinStrategy", () => {
	it("is the terminal fallback", () => {
		expect(new DefaultJoinStrategy().matches(makeContext())).toBe(true);
	});

	it("rejects legacy room names without creating a room", async () => {
		const strategy = new DefaultJoinStrategy();
		const context = makeContext();

		await strategy.handle(context);

		expect(context.socket.destroy).toHaveBeenCalled();
		expect(YGOProRoomList.getRooms()).toHaveLength(0);
	});
});
