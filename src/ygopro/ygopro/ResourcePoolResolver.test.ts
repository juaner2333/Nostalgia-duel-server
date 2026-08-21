import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Logger } from "src/shared/logger/domain/Logger";
import { resolveFormatPath, resolvePools } from "./ResourcePoolResolver";

function makeLogger(): jest.Mocked<Logger> {
	return {
		debug: jest.fn(),
		error: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		child: jest.fn().mockReturnThis(),
	};
}

const FIXED_MANIFEST = {
	runtime: {
		ygopro: {
			base: "base",
			formats: { "1103": "formats/1103", "1109": "formats/1109" },
		},
	},
};

describe("ResourcePoolResolver", () => {
	let tmpDir: string;
	let logger: jest.Mocked<Logger>;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nostalgia-pools-"));
		logger = makeLogger();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function resolve(manifest: unknown): ReturnType<typeof resolvePools> {
		const manifestPath = path.join(tmpDir, "resources.manifest.json");
		fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf-8");
		return resolvePools({ manifestPath, resourcesDir: tmpDir, logger });
	}

	it("maps the fixed base and explicit 1103/1109 format directories", () => {
		const pools = resolve(FIXED_MANIFEST);

		expect(pools).toEqual({
			base: path.join(tmpDir, "ygopro", "base"),
			formats: {
				"1103": path.join(tmpDir, "ygopro", "formats", "1103"),
				"1109": path.join(tmpDir, "ygopro", "formats", "1109"),
			},
		});
	});

	it("rejects unknown and omitted formats", () => {
		const pools = resolve(FIXED_MANIFEST);

		expect(resolveFormatPath(pools, "1103")).toContain("formats/1103");
		expect(() => resolveFormatPath(pools, "1104")).toThrow("Unknown YGOPro format");
		expect(() =>
			resolveFormatPath(resolve({ runtime: { ygopro: { base: "base", formats: {} } } }), "1109"),
		).toThrow("Unknown YGOPro format");
	});

	it("keeps the server up with an unreadable or invalid manifest", () => {
		const pools = resolvePools({
			manifestPath: path.join(tmpDir, "missing.json"),
			resourcesDir: tmpDir,
			logger,
		});

		expect(pools).toEqual({ base: null, formats: {} });
		expect(logger.error).toHaveBeenCalled();
	});

	it("rejects missing fixed runtime fields", () => {
		expect(resolve({ runtime: { ygopro: { formats: {} } } })).toEqual({ base: null, formats: {} });
		expect(logger.error).toHaveBeenCalled();
		logger.error.mockClear();
		expect(resolve({ runtime: { ygopro: { base: "base" } } })).toEqual({
			base: path.join(tmpDir, "ygopro", "base"),
			formats: {},
		});
		expect(logger.error).toHaveBeenCalled();
	});
});
