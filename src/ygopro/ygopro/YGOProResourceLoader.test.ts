import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { YGOProLFList } from "ygopro-lflist-encode";
import { config } from "src/config";
import { YGOProResourceLoader, readWhitelistCardIds } from "./YGOProResourceLoader";

const MANIFEST = {
	runtime: {
		ygopro: {
			base: "base",
			formats: {
				"1103": "formats/1103",
				"1109": "formats/1109",
			},
		},
	},
};

describe("YGOProResourceLoader", () => {
	let tmpDir: string;
	let previousResourcesDir: string;
	let previousManifestPath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nostalgia-loader-"));
		previousResourcesDir = config.resources.dir;
		previousManifestPath = config.resources.manifestPath;
		config.resources.dir = tmpDir;
		config.resources.manifestPath = path.join(tmpDir, "resources.manifest.json");
		fs.writeFileSync(config.resources.manifestPath, JSON.stringify(MANIFEST), "utf-8");
		for (const formatId of ["1103", "1109"]) {
			fs.mkdirSync(path.join(tmpDir, "ygopro", "formats", formatId), { recursive: true });
		}
	});

	afterEach(() => {
		jest.restoreAllMocks();
		config.resources.dir = previousResourcesDir;
		config.resources.manifestPath = previousManifestPath;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("parses only a non-empty whitelist with unique valid card IDs", async () => {
		const whitelistPath = path.join(tmpDir, "whitelist.conf");
		fs.writeFileSync(whitelistPath, "!OCG 1103\n$whitelist\n1 3\n2 0\n3 1\n4 2\n", "utf-8");

		await expect(readWhitelistCardIds(whitelistPath)).resolves.toEqual(new Set([1, 2, 3, 4]));

		fs.writeFileSync(whitelistPath, "!OCG 1103\n1 3\n", "utf-8");
		await expect(readWhitelistCardIds(whitelistPath)).rejects.toThrow("Whitelist marker missing");
	});

	it("binds each format ID to its own LFList hash", async () => {
		const text1103 = "!OCG 1103\n$whitelist\n1 3\n2 0\n";
		const text1109 = "!OCG 1109\n$whitelist\n1 3\n2 1\n";
		fs.writeFileSync(path.join(tmpDir, "ygopro", "formats", "1103", "lflist.conf"), text1103);
		fs.writeFileSync(path.join(tmpDir, "ygopro", "formats", "1109", "lflist.conf"), text1109);
		const timer = jest.spyOn(global, "setInterval").mockReturnValue({} as NodeJS.Timeout);
		const loader = new YGOProResourceLoader();

		expect(await loader.getFormatBanListHash("1103")).toBe(
			new YGOProLFList().fromText(text1103).items[0]?.getHash(),
		);
		expect(await loader.getFormatBanListHash("1109")).toBe(
			new YGOProLFList().fromText(text1109).items[0]?.getHash(),
		);
		timer.mockRestore();
	});

	it("searches only the current format before the fixed base scripts", () => {
		const timer = jest.spyOn(global, "setInterval").mockReturnValue({} as NodeJS.Timeout);
		const loader = new YGOProResourceLoader();

		expect(loader.getFormatScriptPaths("1103")).toEqual([
			path.join(tmpDir, "ygopro", "formats", "1103"),
			path.join(tmpDir, "ygopro", "base"),
		]);
		expect(loader.getFormatScriptPaths("1109")).toEqual([
			path.join(tmpDir, "ygopro", "formats", "1109"),
			path.join(tmpDir, "ygopro", "base"),
		]);
		timer.mockRestore();
	});
});
