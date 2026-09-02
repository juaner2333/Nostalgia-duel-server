// Startup boundary: the resource integrity bootstrap must complete before any
// persistence connection, matchmaking or port listener is opened; when it
// fails, the process must never accept traffic.

const mockBootstrapYgoproResources = jest.fn();
const mockBootstrapPersistence = jest.fn();
const mockBootstrapStatsSubscriptions = jest.fn();
const mockBootstrapWindbot = jest.fn().mockReturnValue(undefined);
const mockComposeJoinStrategies = jest.fn().mockReturnValue({});
const mockSetStrategies = jest.fn();
const mockServerInitialize = jest.fn();
const mockYgoproServerInitialize = jest.fn();
const mockWsYgoproServerInitialize = jest.fn();

jest.mock("./bootstrap/bootstrapYgoproResources", () => ({
	bootstrapYgoproResources: (...args: unknown[]) => mockBootstrapYgoproResources(...args),
}));
jest.mock("./bootstrap/bootstrapPersistence", () => ({
	bootstrapPersistence: (...args: unknown[]) => mockBootstrapPersistence(...args),
}));
jest.mock("./bootstrap/bootstrapStatsSubscriptions", () => ({
	bootstrapStatsSubscriptions: (...args: unknown[]) => mockBootstrapStatsSubscriptions(...args),
}));
jest.mock("./http-server/Server", () => ({
	Server: jest.fn().mockImplementation(() => ({ initialize: mockServerInitialize })),
}));
jest.mock("./socket-server/YGOProServer", () => ({
	YGOProServer: jest.fn().mockImplementation(() => ({ initialize: mockYgoproServerInitialize })),
}));
jest.mock("./socket-server/WSYGOProServer", () => ({
	WSYGOProServer: jest.fn().mockImplementation(() => ({
		initialize: mockWsYgoproServerInitialize,
	})),
}));
jest.mock("./socket-server/HandshakeTicketAuthenticator", () => ({
	HandshakeTicketAuthenticator: jest.fn(),
}));
jest.mock("./shared/ticket/infrastructure/redis/RedisTicketRepository", () => ({
	RedisTicketRepository: jest.fn(),
}));
jest.mock("./web-socket-server/WebSocketSingleton", () => ({
	__esModule: true,
	default: { getInstance: jest.fn() },
}));
jest.mock("./ygopro/windbot/infrastructure/bootstrapWindbot", () => ({
	bootstrapWindbot: (...args: unknown[]) => mockBootstrapWindbot(...args),
}));
jest.mock("./ygopro/room/application/join-strategies/JoinStrategyRegistry", () => ({
	JoinStrategyRegistry: { setStrategies: (value: unknown) => mockSetStrategies(value) },
}));
jest.mock("./ygopro/room/application/join-strategies/composeJoinStrategies", () => ({
	composeJoinStrategies: (...args: unknown[]) => mockComposeJoinStrategies(...args),
}));
jest.mock("./config", () => ({
	config: {
		windbot: { enabled: false },
		servers: {
			mercury: { port: 706, wsPort: 4002 },
			http: { port: 7922 },
		},
	},
}));
jest.mock("@shared/logger/infrastructure/LoggerFactory", () => ({
	__esModule: true,
	default: {
		getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
	},
}));

import { start } from "./index";

function invocationOrder(mocks: jest.Mock[]): number[] {
	return mocks.map((mock) => mock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
}

describe("server startup boundary", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockBootstrapYgoproResources.mockResolvedValue(undefined);
		mockBootstrapPersistence.mockResolvedValue(undefined);
		mockBootstrapStatsSubscriptions.mockResolvedValue(undefined);
	});

	it("verifies resources before persistence and before any port listener opens", async () => {
		await start();

		const [resources, persistence, stats, http, tcp, ws] = invocationOrder([
			mockBootstrapYgoproResources,
			mockBootstrapPersistence,
			mockBootstrapStatsSubscriptions,
			mockServerInitialize,
			mockYgoproServerInitialize,
			mockWsYgoproServerInitialize,
		]);

		expect(resources).toBeLessThan(persistence);
		expect(persistence).toBeLessThan(stats);
		expect(stats).toBeLessThan(http);
		expect(http).toBeLessThan(tcp);
		expect(tcp).toBeLessThan(ws);
	});

	it("opens no connection and no listener when the resource integrity check fails", async () => {
		mockBootstrapYgoproResources.mockRejectedValue(new Error("resource lock drift"));

		await expect(start()).rejects.toThrow("resource lock drift");

		expect(mockBootstrapPersistence).not.toHaveBeenCalled();
		expect(mockBootstrapStatsSubscriptions).not.toHaveBeenCalled();
		expect(mockServerInitialize).not.toHaveBeenCalled();
		expect(mockYgoproServerInitialize).not.toHaveBeenCalled();
		expect(mockWsYgoproServerInitialize).not.toHaveBeenCalled();
	});
});
