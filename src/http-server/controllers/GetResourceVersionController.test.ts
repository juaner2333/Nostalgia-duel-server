import type { Request, Response } from "express";

const loaderState = {
	isInitialized: true,
	baseSha512Hex: null as string | null,
};
const banlistState = {
	ygopro: [] as Array<{ name: string | null; hash: number }>,
};
const lockState = {
	text: JSON.stringify({
		schemaVersion: 1,
		inputs: {
			baseDatabase: { count: 5120, cardIdsSha256: "base-pool" },
		},
		formats: {
			"1103": {
				cardPool: { count: 5002, cardIdsSha256: "pool-1103" },
				lflist: { hash: 1103, sha256: "lflist-1103" },
			},
			"1109": {
				cardPool: { count: 5120, cardIdsSha256: "pool-1109" },
				lflist: { hash: 1109, sha256: "lflist-1109" },
			},
		},
	}),
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
jest.mock("node:fs", () => ({
	readFileSync: () => lockState.text,
}));
jest.mock("src/config", () => ({
	config: { resources: { dir: "/fixed/resources" } },
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
		loaderState.baseSha512Hex = null;
		banlistState.ygopro = [];
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

	it("reports the fixed base database sha512 when the loader has it", () => {
		loaderState.baseSha512Hex = "abc123";

		const body = run().body() as { ygopro: { baseSha512: string } };

		expect(body.ygopro.baseSha512).toBe("abc123");
	});

	it("reports null ygopro hashes before the loader is initialized", () => {
		loaderState.isInitialized = false;

		const body = run().body() as { ygopro: { baseSha512: string | null } };

		expect(body.ygopro.baseSha512).toBeNull();
	});

	it("maps banlists to name and hash", () => {
		banlistState.ygopro = [{ name: "2026.04", hash: 222 }];

		const body = run().body() as {
			banlists: {
				ygopro: Array<{ name: string; hash: number }>;
			};
		};

		expect(body.banlists.ygopro).toEqual([{ name: "2026.04", hash: 222 }]);
	});

	it("skips unnamed banlists", () => {
		banlistState.ygopro = [
			{ name: null, hash: 1 },
			{ name: "Named", hash: 2 },
		];

		const body = run().body() as { banlists: { ygopro: Array<{ name: string; hash: number }> } };

		expect(body.banlists.ygopro).toEqual([{ name: "Named", hash: 2 }]);
	});

	it("reports fixed resource lock and two format summaries", () => {
		const body = run().body() as {
			fixedNostalgia: {
				schemaVersion: number;
				lock: { sha256: string };
				baseDatabase: { count: number; cardIdsSha256: string };
				formats: Record<string, { cardPool: { count: number }; lflist: { hash: number } }>;
			};
		};

		expect(body.fixedNostalgia.schemaVersion).toBe(1);
		expect(body.fixedNostalgia.lock.sha256).toHaveLength(64);
		expect(body.fixedNostalgia.baseDatabase).toEqual({ count: 5120, cardIdsSha256: "base-pool" });
		expect(body.fixedNostalgia.formats["1103"].cardPool.count).toBe(5002);
		expect(body.fixedNostalgia.formats["1109"].lflist.hash).toBe(1109);
	});

	it("reports only the app-bundled lock with exactly the 1103/1109 summaries", () => {
		const body = run().body() as {
			fixedNostalgia: {
				schemaVersion: number;
				lock: { sha256: string };
				baseDatabase: { count: number; cardIdsSha256: string };
				formats: Record<string, unknown>;
			};
		};

		const fixedNostalgia = body.fixedNostalgia;
		expect(Object.keys(fixedNostalgia).sort()).toEqual([
			"baseDatabase",
			"formats",
			"lock",
			"schemaVersion",
		]);
		expect(Object.keys(fixedNostalgia.formats).sort()).toEqual(["1103", "1109"]);
		expect(fixedNostalgia.lock.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(body).not.toHaveProperty("sources");
		expect(body).not.toHaveProperty("releases");
		expect(body).not.toHaveProperty("edopro");
	});

	it("ignores external source or release keys in the lock file", () => {
		lockState.text = JSON.stringify({
			schemaVersion: 1,
			sources: [{ id: "upstream", type: "git" }],
			releases: ["20260101-000000-000000000"],
			inputs: {
				baseDatabase: { count: 5120, cardIdsSha256: "base-pool" },
			},
			formats: {
				"1103": {
					cardPool: { count: 5002, cardIdsSha256: "pool-1103" },
					lflist: { hash: 1103, sha256: "lflist-1103" },
				},
				"1109": {
					cardPool: { count: 5120, cardIdsSha256: "pool-1109" },
					lflist: { hash: 1109, sha256: "lflist-1109" },
				},
			},
		});
		try {
			const body = run().body() as {
				fixedNostalgia: Record<string, unknown>;
			};
			expect(body.fixedNostalgia).toMatchObject({
				schemaVersion: 1,
				baseDatabase: { count: 5120, cardIdsSha256: "base-pool" },
			});
			expect(body.fixedNostalgia).not.toHaveProperty("sources");
			expect(body.fixedNostalgia).not.toHaveProperty("releases");
			expect(Object.keys(body.fixedNostalgia.formats as Record<string, unknown>).sort()).toEqual([
				"1103",
				"1109",
			]);
		} finally {
			lockState.text = JSON.stringify({
				schemaVersion: 1,
				inputs: {
					baseDatabase: { count: 5120, cardIdsSha256: "base-pool" },
				},
				formats: {
					"1103": {
						cardPool: { count: 5002, cardIdsSha256: "pool-1103" },
						lflist: { hash: 1103, sha256: "lflist-1103" },
					},
					"1109": {
						cardPool: { count: 5120, cardIdsSha256: "pool-1109" },
						lflist: { hash: 1109, sha256: "lflist-1109" },
					},
				},
			});
		}
	});
});
