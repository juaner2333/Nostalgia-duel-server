// Contract test for the spectator WebSocket's GET-ROOMS snapshot.
//
// The connection payload is a neutral external contract: { action: "GET-ROOMS",
// data: [...] } where data holds toRealTimePresentation() of every live room with
// turn !== 0. The snapshot is sourced exclusively from the YGOPro room list.

jest.mock("node:http", () => ({
	createServer: jest.fn(() => ({ listen: jest.fn() })),
}));
jest.mock("src/config", () => ({
	config: { servers: { websocket: { port: 0 } } },
}));
jest.mock("src/shared/logger/infrastructure/LoggerFactory", () => ({
	__esModule: true,
	default: {
		getLogger: () => ({
			info: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn(),
		}),
	},
}));
jest.mock("ws", () => ({
	WebSocket: { OPEN: 1 },
	WebSocketServer: jest.fn(),
}));
jest.mock("@ygopro/room/infrastructure/YGOProRoomList", () => ({
	__esModule: true,
	default: { getRooms: jest.fn() },
}));

import { WebSocketServer } from "ws";
import YGOProRoomList from "@ygopro/room/infrastructure/YGOProRoomList";

import WebSocketSingleton from "./WebSocketSingleton";

interface FakeRoom {
	turn: number;
	toRealTimePresentation: () => Record<string, unknown>;
}

const MockWebSocketServer = WebSocketServer as unknown as jest.Mock;
const MockRoomList = YGOProRoomList as unknown as { getRooms: jest.Mock };

function fakeRoom(turn: number, presentation: Record<string, unknown>): FakeRoom {
	return { turn, toRealTimePresentation: () => presentation };
}

describe("WebSocketSingleton — GET-ROOMS contract", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("sends only YGOPro rooms with turn !== 0 on connection", () => {
		const wssInstance = { on: jest.fn(), clients: [] };
		MockWebSocketServer.mockImplementation(() => wssInstance);

		const live = fakeRoom(5, { id: 1, turn: 5 });
		const pending = fakeRoom(0, { id: 2, turn: 0 });
		MockRoomList.getRooms.mockReturnValue([live, pending]);

		WebSocketSingleton.getInstance();

		const registered = wssInstance.on.mock.calls.find(([event]) => event === "connection");
		expect(registered).toBeDefined();
		const onConnection = registered?.[1] as (ws: { send: jest.Mock }) => void;

		const send = jest.fn();
		onConnection({ send });

		expect(MockRoomList.getRooms).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledWith(
			JSON.stringify({ action: "GET-ROOMS", data: [{ id: 1, turn: 5 }] }),
		);
	});
});
