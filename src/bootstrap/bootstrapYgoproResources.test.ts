// Startup boundary: the full resource lock check must run before any resource
// loading, persistence connection or port listener accepts traffic.

jest.mock("@ygopro/ygopro/YGOProResourceLoader", () => ({
	YGOProResourceLoader: {
		start: jest.fn(),
		get: jest.fn().mockReturnValue({ logLFLists: jest.fn() }),
		getShared: jest.fn().mockReturnValue({
			getFormatCardStorage: jest.fn().mockResolvedValue({}),
			getOcgcoreWasmModule: jest.fn().mockResolvedValue({}),
		}),
	},
}));
jest.mock("@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository", () => ({
	__esModule: true,
	default: { replaceAll: jest.fn() },
}));
jest.mock("./bootstrapBanListLoaders", () => ({
	loadYgoproBanLists: jest.fn().mockResolvedValue([]),
}));

import { YGOProResourceLoader } from "@ygopro/ygopro/YGOProResourceLoader";
import YGOProBanListMemoryRepository from "@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository";
import type { Logger } from "@shared/logger/domain/Logger";
import path from "node:path";
import { config } from "src/config";
import { bootstrapYgoproResources } from "./bootstrapYgoproResources";

// Exercises the real fixed-resource lock check: with parallel workers that
// easily outruns Jest's 5s default without being a real failure.
jest.setTimeout(60_000);

const MockStart = YGOProResourceLoader.start as unknown as jest.Mock;
const MockGetShared = YGOProResourceLoader.getShared as unknown as jest.Mock;

function fakeLogger(): Logger {
	return {
		info: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
		debug: jest.fn(),
	} as unknown as Logger;
}

describe("bootstrapYgoproResources startup boundary", () => {
	const originalProfile = config.resources.profile;

	beforeEach(() => {
		jest.clearAllMocks();
		config.resources.profile = "goat";
	});

	afterEach(() => {
		config.resources.profile = originalProfile;
	});

	it("rejects before loading any resource when the fixed resource lock is missing", async () => {
		// Point the app at an empty resource root: no lock.json exists, so the
		// integrity check must fail and nothing may be loaded afterwards.
		const originalDir = config.resources.dir;
		config.resources.dir = "/nonexistent-nostalgia-resources";
		try {
			await expect(bootstrapYgoproResources(fakeLogger())).rejects.toThrow();
			expect(MockStart).not.toHaveBeenCalled();
			expect(YGOProBanListMemoryRepository.replaceAll).not.toHaveBeenCalled();
		} finally {
			config.resources.dir = originalDir;
		}
	});

	it("runs the full lock check on the configured resource root before loading", async () => {
		// With a valid lock tree the loader starts; the check is exercised against
		// the real bundled resource root so a drift fails this test too.
		const originalDir = config.resources.dir;
		config.resources.dir = path.join(path.resolve(__dirname, "../.."), "nostalgia-resources");
		try {
			await expect(bootstrapYgoproResources(fakeLogger())).resolves.toBeUndefined();
			expect(MockStart).toHaveBeenCalledTimes(1);
			expect(MockGetShared().getFormatCardStorage).toHaveBeenCalledTimes(1);
			expect(MockGetShared().getFormatCardStorage).toHaveBeenCalledWith("goat");
			expect(MockGetShared().getOcgcoreWasmModule).toHaveBeenCalledTimes(1);
			expect(YGOProBanListMemoryRepository.replaceAll).toHaveBeenCalledTimes(1);
		} finally {
			config.resources.dir = originalDir;
		}
	});

	it("fails fast before loading ban lists when a pre-warm step fails", async () => {
		const originalDir = config.resources.dir;
		config.resources.dir = path.join(path.resolve(__dirname, "../.."), "nostalgia-resources");
		try {
			MockGetShared().getOcgcoreWasmModule.mockRejectedValueOnce(
				new Error("koishipro-core.js WASM layout changed"),
			);
			await expect(bootstrapYgoproResources(fakeLogger())).rejects.toThrow(
				"koishipro-core.js WASM layout changed",
			);
			expect(YGOProBanListMemoryRepository.replaceAll).not.toHaveBeenCalled();
		} finally {
			config.resources.dir = originalDir;
		}
	});
});
