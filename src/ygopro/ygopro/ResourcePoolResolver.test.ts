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

	it("derives the fixed base and both 1103/1109 format directories from a single resource root", () => {
		const pools = resolvePools({ resourcesDir: tmpDir, logger });

		expect(pools).toEqual({
			base: path.join(tmpDir, "ygopro", "base"),
			formats: {
				"1103": path.join(tmpDir, "ygopro", "formats", "1103"),
				"1109": path.join(tmpDir, "ygopro", "formats", "1109"),
			},
		});
	});

	it("never reads a manifest and never resolves from resources/current", () => {
		// No resources.manifest.json exists anywhere; a decoy assembled layout
		// under resources/current must be ignored by the resolver.
		fs.mkdirSync(path.join(tmpDir, "resources", "current"), { recursive: true });

		const pools = resolvePools({ resourcesDir: tmpDir, logger });

		expect(pools.base).toBe(path.join(tmpDir, "ygopro", "base"));
		expect(pools.base).not.toContain("resources/current");
		expect(pools.formats["1103"]).toBe(path.join(tmpDir, "ygopro", "formats", "1103"));
		expect(pools.formats["1109"]).toBe(path.join(tmpDir, "ygopro", "formats", "1109"));
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("warns about missing directories without failing the resolution", () => {
		const pools = resolvePools({ resourcesDir: tmpDir, logger });

		expect(pools.base).toBe(path.join(tmpDir, "ygopro", "base"));
		expect(logger.warn).toHaveBeenCalled();
	});

	it("rejects any format outside the fixed 1103/1109 registry", () => {
		const pools = resolvePools({ resourcesDir: tmpDir, logger });

		expect(() => resolveFormatPath(pools, "1104")).toThrow("Unknown YGOPro format");
		expect(() => resolveFormatPath(pools, "1110")).toThrow("Unknown YGOPro format");
		expect(() => resolveFormatPath(pools, "goat")).toThrow("Unknown YGOPro format");
	});
});
