import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DirScriptReaderEx } from "koishipro-core.js";
import { YGOProLFList } from "ygopro-lflist-encode";
import { config } from "src/config";
import { YGOProResourceLoader, readWhitelistCardIds } from "./YGOProResourceLoader";

describe("YGOProResourceLoader", () => {
	let tmpDir: string;
	let previousResourcesDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nostalgia-loader-"));
		previousResourcesDir = config.resources.dir;
		config.resources.dir = tmpDir;
		for (const formatId of ["1103", "1109"]) {
			fs.mkdirSync(path.join(tmpDir, "ygopro", "formats", formatId), { recursive: true });
		}
		fs.mkdirSync(path.join(tmpDir, "ygopro", "base"), { recursive: true });
	});

	afterEach(() => {
		jest.restoreAllMocks();
		config.resources.dir = previousResourcesDir;
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
		const loader = new YGOProResourceLoader();

		expect(await loader.getFormatBanListHash("1103")).toBe(
			new YGOProLFList().fromText(text1103).items[0]?.getHash(),
		);
		expect(await loader.getFormatBanListHash("1109")).toBe(
			new YGOProLFList().fromText(text1109).items[0]?.getHash(),
		);
	});

	it("searches only the current format before the fixed base scripts", () => {
		const loader = new YGOProResourceLoader();

		expect(loader.getFormatScriptPaths("1103")).toEqual([
			path.join(tmpDir, "ygopro", "formats", "1103"),
			path.join(tmpDir, "ygopro", "base"),
		]);
		expect(loader.getFormatScriptPaths("1109")).toEqual([
			path.join(tmpDir, "ygopro", "formats", "1109"),
			path.join(tmpDir, "ygopro", "base"),
		]);
	});

	it("derives preload script paths only when the format special.lua exists", () => {
		const loader = new YGOProResourceLoader();

		// no special.lua anywhere: empty preload list, current behavior unchanged
		expect(loader.getFormatPreloadScriptPaths("1103")).toEqual([]);
		expect(loader.getFormatPreloadScriptPaths("1109")).toEqual([]);

		// 1103 gets a special.lua: only its own reader-resolvable relative name
		// is derived, not the other format's
		fs.mkdirSync(path.join(tmpDir, "ygopro", "formats", "1103", "script"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, "ygopro", "formats", "1103", "script", "special.lua"),
			"-- patch\n",
		);
		expect(loader.getFormatPreloadScriptPaths("1103")).toEqual(["script/special.lua"]);
		expect(loader.getFormatPreloadScriptPaths("1109")).toEqual([]);
	});

	it("returns a preload script name the koishipro script reader can resolve", async () => {
		// production assembly: the name derived by the loader must resolve
		// through DirScriptReaderEx against the format-first script chain
		const loader = new YGOProResourceLoader();
		const formatPath = path.join(tmpDir, "ygopro", "formats", "1103");
		const scriptDir = path.join(formatPath, "script");
		fs.mkdirSync(scriptDir, { recursive: true });
		fs.writeFileSync(path.join(scriptDir, "special.lua"), "-- patch\n");
		const scriptReader = await DirScriptReaderEx(formatPath, path.join(tmpDir, "ygopro", "base"));
		const [name] = loader.getFormatPreloadScriptPaths("1103");
		expect(name).toBe("script/special.lua");
		// the reader must return the patch content for that name (not null)
		expect(scriptReader(name!)).not.toBeNull();
		expect(Buffer.from(scriptReader(name!) as Uint8Array).toString()).toBe("-- patch\n");
		// an absolute path must NOT be used: it never resolves through the reader
		expect(scriptReader(path.join(scriptDir, "special.lua"))).toBeNull();
	});
});
