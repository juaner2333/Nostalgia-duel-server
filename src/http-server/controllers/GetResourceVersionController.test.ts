import type { Request, Response } from "express";

const loaderState = {
	isInitialized: true,
	standardSha512Hex: null as string | null,
	extendedSha512Hex: null as string | null,
};
const banlistState = {
	ygopro: [] as Array<{ name: string | null; hash: number }>,
	reloadedAt: null as string | null,
};

jest.mock("@ygopro/ygopro/YGOProResourceLoader", () => ({
	YGOProResourceLoader: {
		get isInitialized() {
			return loaderState.isInitialized;
		},
		get: () => loaderState,
	},
}));
jest.mock("@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository", () => ({
	__esModule: true,
	default: { get: () => banlistState.ygopro },
}));
jest.mock("src/bootstrap/bootstrapBanListReloader", () => ({
	getBanListReloadedAt: () => banlistState.reloadedAt,
}));

import { GetResourceVersionController } from "./GetResourceVersionController";

function fakeResponse(): { res: Response; body: () => unknown; status: () => number } {
	let statusCode = 0;
	let payload: unknown;
	const res = {
		status(code: number) {
			statusCode = code;
			return this;
		},
		json(data: unknown) {
			payload = data;
			return this;
		},
	} as unknown as Response;
	return { res, body: () => payload, status: () => statusCode };
}

function run(): ReturnType<typeof fakeResponse> {
	const out = fakeResponse();
	new GetResourceVersionController().run({} as Request, out.res);
	return out;
}

describe("GetResourceVersionController", () => {
	beforeEach(() => {
		loaderState.isInitialized = true;
		loaderState.standardSha512Hex = null;
		loaderState.extendedSha512Hex = null;
		banlistState.ygopro = [];
		banlistState.reloadedAt = null;
	});

	it("returns schemaVersion 1 and the ygopro sections with a 200 status", () => {
		const out = run();

		expect(out.status()).toBe(200);
		expect(out.body()).toMatchObject({
			schemaVersion: 1,
			ygopro: expect.any(Object),
			banlists: expect.any(Object),
		});
		const body = out.body() as Record<string, unknown>;
		expect(body).not.toHaveProperty("edopro");
		expect(body.banlists).not.toHaveProperty("edopro");
	});

	it("reports the ygopro sha512 hexes when the loader has them", () => {
		loaderState.standardSha512Hex = "abc123";
		loaderState.extendedSha512Hex = "def456";

		const body = run().body() as { ygopro: { standardSha512: string; extendedSha512: string } };

		expect(body.ygopro.standardSha512).toBe("abc123");
		expect(body.ygopro.extendedSha512).toBe("def456");
	});

	it("reports null ygopro hashes before the loader is initialized", () => {
		loaderState.isInitialized = false;

		const body = run().body() as { ygopro: { standardSha512: string | null } };

		expect(body.ygopro.standardSha512).toBeNull();
	});

	it("maps banlists to name+hash and passes through reloadedAt", () => {
		banlistState.ygopro = [{ name: "2026.04", hash: 222 }];
		banlistState.reloadedAt = "2026-07-14T12:00:00.000Z";

		const body = run().body() as {
			banlists: {
				ygopro: Array<{ name: string; hash: number }>;
				reloadedAt: string;
			};
		};

		expect(body.banlists.ygopro).toEqual([{ name: "2026.04", hash: 222 }]);
		expect(body.banlists.reloadedAt).toBe("2026-07-14T12:00:00.000Z");
	});

	it("skips unnamed banlists", () => {
		banlistState.ygopro = [
			{ name: null, hash: 1 },
			{ name: "Named", hash: 2 },
		];

		const body = run().body() as { banlists: { ygopro: Array<{ name: string; hash: number }> } };

		expect(body.banlists.ygopro).toEqual([{ name: "Named", hash: 2 }]);
	});
});
