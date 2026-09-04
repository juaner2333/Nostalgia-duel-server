/**
 * HTTP contract tests for the YGOPro-only server surface.
 *
 * These lock the end state after the EDOPro removal (tasks 5.1–5.4): the
 * retained HTTP endpoints — rooms, ban lists, databases, card search, resource
 * version, the inspect page and admin broadcasts — run on YGOPro data only,
 * reject `edopro` engine inputs, and omit `edopro` response branches.
 *
 * Controllers are exercised directly with fake express Request/Response
 * objects (the repo's established pattern — no supertest, no port binding).
 */

jest.mock("@ygopro/card/infrastructure/YGOProCardSearchRepository");
jest.mock("@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository", () => ({
	__esModule: true,
	default: { get: jest.fn(), findByName: jest.fn() },
}));
jest.mock("@ygopro/room/infrastructure/YGOProRoomList", () => ({
	__esModule: true,
	default: { getRooms: jest.fn() },
}));
jest.mock("@ygopro/ygopro/YGOProResourceLoader", () => ({
	YGOProResourceLoader: { isInitialized: false, get: () => null },
}));

import express, { type Request, type Response } from "express";
import { loadRoutes } from "./routes";

import YGOProBanListMemoryRepository from "@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository";
import YGOProRoomList from "@ygopro/room/infrastructure/YGOProRoomList";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { config } from "../config";

import { cardRepositories } from "./composition/CardRepositories";
import { CreateRoomController } from "./controllers/CreateRoomController";
import { GetBanListDetailController } from "./controllers/GetBanListDetailController";
import { GetBanListsController } from "./controllers/GetBanListsController";
import { GetDatabaseCardsController } from "./controllers/GetDatabaseCardsController";
import { GetDatabasesController } from "./controllers/GetDatabasesController";
import { GetResourceVersionController } from "./controllers/GetResourceVersionController";
import { GetRoomListController } from "./controllers/GetRoomListController";
import { InspectPageController } from "./controllers/InspectPageController";
import { SearchCardsController } from "./controllers/SearchCardsController";
import { ServerMessagesController } from "./controllers/ServerMessagesController";

function fakeResponse(): {
	res: Response;
	body: () => unknown;
	text: () => unknown;
	status: () => number;
} {
	let statusCode = 0;
	let payload: unknown;
	let textPayload: unknown;
	const res = {
		status(code: number) {
			statusCode = code;
			return this;
		},
		json(data: unknown) {
			payload = data;
			return this;
		},
		send(data: unknown) {
			textPayload = data;
			return this;
		},
		setHeader: () => res,
		getHeader: () => undefined,
		type: () => res,
	} as unknown as Response;
	return {
		res,
		body: () => payload,
		text: () => textPayload,
		status: () => statusCode,
	};
}

const fakeRequest = (request: Partial<Request>): Request => request as Request;

const asMock = (fn: unknown): jest.Mock => fn as jest.Mock;

describe("YGOPro-only HTTP contract", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("GET /api/databases omits the edopro branch", async () => {
		asMock(cardRepositories.ygopro.listSources).mockResolvedValue(["standard.cdb"]);

		const out = fakeResponse();
		await new GetDatabasesController().run(fakeRequest({}), out.res);

		expect(out.status()).toBe(200);
		expect(out.body()).not.toHaveProperty("edopro");
		expect(out.body()).toMatchObject({ ygopro: ["standard.cdb"] });
	});

	it("GET /api/banlists omits the edopro branch", () => {
		asMock(YGOProBanListMemoryRepository.get).mockReturnValue([]);

		const out = fakeResponse();
		new GetBanListsController().run(fakeRequest({}), out.res);

		expect(out.status()).toBe(200);
		expect(out.body()).not.toHaveProperty("edopro");
		expect(out.body()).toHaveProperty("ygopro");
	});

	it("GET /api/banlists/:engine/:name rejects the edopro engine", async () => {
		asMock(YGOProBanListMemoryRepository.findByName).mockReturnValue(null);

		const out = fakeResponse();
		await new GetBanListDetailController().run(
			fakeRequest({ params: { engine: "edopro", name: "2026.1" } }),
			out.res,
		);

		expect(out.status()).toBe(400);
		expect(asMock(YGOProBanListMemoryRepository.findByName)).not.toHaveBeenCalled();
	});

	it("GET /api/banlists/:engine/:name serves the ygopro engine", async () => {
		const banList = {
			name: "2026.1",
			hash: 123,
			forbidden: [1],
			limited: [2],
			semiLimited: [],
			all: [],
			points: new Map(),
			isWhiteListed: false,
			isGenesys: () => false,
		};
		asMock(YGOProBanListMemoryRepository.findByName).mockReturnValue(banList);
		asMock(cardRepositories.ygopro.resolveNames).mockResolvedValue(
			new Map([
				[1, "a"],
				[2, "b"],
			]),
		);

		const out = fakeResponse();
		await new GetBanListDetailController().run(
			fakeRequest({ params: { engine: "ygopro", name: "2026.1" } }),
			out.res,
		);

		expect(out.status()).toBe(200);
		const body = out.body() as { engine: string };
		expect(body.engine).toBe("ygopro");
	});

	it("GET /api/databases/cards rejects the edopro engine", async () => {
		asMock(cardRepositories.ygopro.findBySource).mockResolvedValue({ cards: [], total: 0 });

		const out = fakeResponse();
		await new GetDatabaseCardsController().run(
			fakeRequest({ query: { engine: "edopro", source: "edopro-cards.cdb" } }),
			out.res,
		);

		expect(out.status()).toBe(400);
		expect(asMock(cardRepositories.ygopro.findBySource)).not.toHaveBeenCalled();
	});

	it("GET /api/cards answers from the ygopro repository even for an edopro engine filter", async () => {
		asMock(cardRepositories.ygopro.searchByName).mockResolvedValue([
			{ id: 89631139, name: "Blue-Eyes White Dragon", source: "cards.cdb" },
		]);

		const out = fakeResponse();
		await new SearchCardsController().run(
			fakeRequest({ query: { q: "blue", engine: "edopro" } }),
			out.res,
		);

		expect(out.status()).toBe(200);
		expect(asMock(cardRepositories.ygopro.searchByName)).toHaveBeenCalledTimes(1);
		const body = out.body() as { results: Array<{ engine: string; id: number }> };
		expect(body.results).toHaveLength(1);
		expect(body.results[0].engine).toBe("ygopro");
	});

	it("GET /api/resources/version omits all edopro sections", () => {
		asMock(YGOProBanListMemoryRepository.get).mockReturnValue([]);

		const out = fakeResponse();
		new GetResourceVersionController().run(fakeRequest({}), out.res);

		const body = out.body() as Record<string, unknown>;
		expect(out.status()).toBe(200);
		expect(body).not.toHaveProperty("edopro");
		expect(body.banlists).not.toHaveProperty("edopro");
		expect(body).toHaveProperty("ygopro");
	});

	it("POST /api/room reports room creation as unavailable", () => {
		const out = fakeResponse();
		new CreateRoomController(new LoggerMock()).run(
			fakeRequest({
				body: { name: "room1", banlist: "2026.1" },
			}),
			out.res,
		);

		expect(out.status()).toBe(501);
		expect(out.body()).toMatchObject({ success: false });
	});

	it("GET /api/getrooms lists only YGOPro rooms", () => {
		asMock(YGOProRoomList.getRooms).mockReturnValue([
			{ toPresentation: () => ({ engine: "ygopro" }) },
		]);

		const out = fakeResponse();
		new GetRoomListController().run(fakeRequest({}), out.res);

		const body = out.body() as { rooms: Array<{ engine: string }> };
		expect(out.status()).toBe(200);
		expect(body.rooms).toHaveLength(1);
		expect(body.rooms[0].engine).toBe("ygopro");
	});

	it("GET / renders the inspect page without edopro branches", () => {
		const out = fakeResponse();
		new InspectPageController().run(fakeRequest({}), out.res);

		const html = out.text() as string;
		expect(out.status()).toBe(200);
		expect(html).toBeDefined();
		expect(html).not.toContain("edopro");
	});

	it("POST /api/admin/message notifies only YGOPro rooms with a YGOPro-compatible frame", async () => {
		const ygoproSend = jest.fn();
		asMock(YGOProRoomList.getRooms).mockReturnValue([
			{ players: [{ socket: { send: ygoproSend } }], spectators: [] },
		]);

		const out = fakeResponse();
		await new ServerMessagesController().run(
			fakeRequest({ body: { message: "restart soon", reason: "notice" } }),
			out.res,
		);

		expect(out.status()).toBe(200);
		expect(ygoproSend).toHaveBeenCalledTimes(1);
		const frame = ygoproSend.mock.calls[0][0] as Buffer;
		expect(frame[2]).toBe(0x19); // YGOPro STOC_CHAT
	});

	it("does not mount any matchmaking routes", () => {
		const app = express();
		const mockTickets = {} as any;
		const logger = new LoggerMock();

		loadRoutes(app, logger, mockTickets);

		const stack = (app._router || (app as any).router)?.stack || [];
		const routes = stack.filter((r: any) => r.route).map((r: any) => r.route.path);

		expect(routes).not.toContain("/api/matchmaking/queue");
		expect(routes).not.toContain("/api/matchmaking/status");
	});

	it("mounts POST /api/admin/users/reset-password behind admin auth, returning 401 when key is missing or invalid", async () => {
		const app = express();
		app.use(express.json());
		const mockTickets = {} as any;
		const logger = new LoggerMock();

		loadRoutes(app, logger, mockTickets);

		const stack = (app._router || (app as any).router)?.stack || [];
		const routes = stack
			.filter((r: any) => r.route)
			.map((r: any) => ({
				path: r.route.path,
				methods: Object.keys(r.route.methods),
			}));
		expect(routes).toContainEqual({
			path: "/api/admin/users/reset-password",
			methods: ["post"],
		});

		const originalAdminKey = config.adminApiKey;
		config.adminApiKey = "test-admin-key";

		try {
			// Missing key -> 401
			const outNoKey = fakeResponse();
			await new Promise<void>((resolve) => {
				const req = {
					method: "POST",
					url: "/api/admin/users/reset-password",
					headers: {},
					query: {},
					body: { username: "Duelist" },
				} as any;
				const originalJson = outNoKey.res.json.bind(outNoKey.res);
				outNoKey.res.json = (data: unknown) => {
					originalJson(data);
					resolve();
					return outNoKey.res;
				};
				(app as any).handle(req, outNoKey.res);
			});
			expect(outNoKey.status()).toBe(401);

			// Invalid key -> 401
			const outBadKey = fakeResponse();
			await new Promise<void>((resolve) => {
				const req = {
					method: "POST",
					url: "/api/admin/users/reset-password",
					headers: { "admin-api-key": "wrong-key" },
					query: {},
					body: { username: "Duelist" },
				} as any;
				const originalJson = outBadKey.res.json.bind(outBadKey.res);
				outBadKey.res.json = (data: unknown) => {
					originalJson(data);
					resolve();
					return outBadKey.res;
				};
				(app as any).handle(req, outBadKey.res);
			});
			expect(outBadKey.status()).toBe(401);
		} finally {
			config.adminApiKey = originalAdminKey;
		}
	});
});
