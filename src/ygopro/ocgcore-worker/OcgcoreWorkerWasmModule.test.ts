/**
 * WASM precompile + cross-worker transport integration tests.
 *
 * The main thread precompiles `libocgcore.wasm` into a shared
 * `WebAssembly.Module` and passes it through `initWorker`. yuzuthread's
 * BUILTIN_TYPES whitelist has no entry for WebAssembly.Module, so without the
 * identity @TransportEncoder the CustomClass branch would serialize the module
 * into a shell {} (it has no enumerable own properties) and every worker init
 * would crash. These tests lock the transport with real worker threads:
 *
 * a) a real `initWorker` call receives the module intact (behavior assertion:
 *    the worker instantiates and drives `process()`; `instanceof
 *    WebAssembly.Module` in the worker is the auxiliary assertion), and
 * b) a corrupted (un-instantiable) module must fail worker init explicitly
 *    within a bounded time instead of hanging forever.
 */

import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { YGOProCdb } from "ygopro-cdb-encode";
import YGOProDeck from "ygopro-deck-encode";
import { initWorker } from "yuzuthread";

import { OcgcoreModuleProbeWorker } from "@test-support/workers/OcgcoreModuleProbeWorker";
import { registerWorkerTsSupport } from "@test-support/workers/register-worker-ts";
import { CardStorage } from "../ygopro/card-storage";
import { readWhitelistCardIds } from "../ygopro/YGOProResourceLoader";
import { OcgcoreWorker } from "./ocgcore-worker";
import { OcgcoreWorkerOptions } from "./ocgcore-worker-options";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const RESOURCE_ROOT = path.join(PROJECT_ROOT, "nostalgia-resources");

const HOST_INFO = {
	lflist: 0,
	rule: 0,
	mode: 1,
	duel_rule: 2,
	no_check_deck: 0,
	no_shuffle_deck: 0,
	start_lp: 8000,
	start_hand: 5,
	draw_count: 1,
	time_limit: 450,
};

const loadBaseCardStorage = async (): Promise<CardStorage> => {
	const SQL = await initSqlJs();
	const cdb = new YGOProCdb(
		new SQL.Database(fs.readFileSync(path.join(RESOURCE_ROOT, "ygopro", "base", "cards.cdb"))),
	).noTexts();
	const storage = CardStorage.fromCards(cdb.step());
	cdb.finalize();
	return storage;
};

const findDeckCardId = (formatId: string, basePath: string, pool: Set<number>): number => {
	const limits = new Map<number, number>();
	for (const line of fs
		.readFileSync(path.join(RESOURCE_ROOT, "ygopro", "formats", formatId, "lflist.conf"), "utf-8")
		.split(/\r?\n/)) {
		const match = /^(\d+)\s+([0-3])(?:\s|$)/.exec(line.trim());
		if (match) {
			limits.set(Number(match[1]), Number(match[2]));
		}
	}
	const cardId = [...pool].find(
		(id) => limits.get(id) === 3 && fs.existsSync(path.join(basePath, "script", `c${id}.lua`)),
	);
	if (!cardId) {
		throw new Error(`No unrestricted scripted card in format ${formatId}`);
	}
	return cardId;
};

const makeWorkerOptions = async (
	ocgcoreWasmModule: WebAssembly.Module,
): Promise<OcgcoreWorkerOptions> => {
	const basePath = path.join(RESOURCE_ROOT, "ygopro", "base");
	const formatPath = path.join(RESOURCE_ROOT, "ygopro", "formats", "1103");
	const pool = await readWhitelistCardIds(path.join(formatPath, "lflist.conf"));
	const cardId = findDeckCardId("1103", basePath, pool);
	const baseStorage = await loadBaseCardStorage();
	const cardStorage = baseStorage.filterByCardIds(pool);
	const deck = new YGOProDeck({
		main: Array.from({ length: 40 }, () => cardId),
		side: [],
		extra: [],
	});
	const mirroredDeck = new YGOProDeck({
		main: Array.from({ length: 40 }, () => cardId),
		side: [],
		extra: [],
	});

	return {
		ygoproPaths: [formatPath, basePath],
		extraScriptPaths: [],
		cardStorage,
		ocgcoreWasmModule,
		seed: [1, 2, 3, 4],
		hostinfo: HOST_INFO,
		// Two distinct instances: yuzuthread's visited-set treats a shared
		// object reference inside one encoded tree as a circular reference.
		decks: [deck, mirroredDeck],
		registry: {},
	};
};

/**
 * A module that compiles but can never instantiate (missing env import).
 */
const buildCorruptModule = (): WebAssembly.Module =>
	new WebAssembly.Module(
		Uint8Array.from([
			0,
			97,
			115,
			109,
			1,
			0,
			0,
			0, // magic + version
			1,
			4,
			1,
			0x60,
			0,
			0, // type section: (func)
			2,
			9,
			1,
			3,
			0x65,
			0x6e,
			0x76,
			1,
			0x66,
			0,
			0, // import "env"."f" (func)
		]),
	);

describe("OcgcoreWorker precompiled WASM module transport", () => {
	jest.setTimeout(30_000);

	beforeAll(() => {
		// Jest cannot load yuzuthread worker classes natively (strip-only mode
		// rejects decorators); ts-node support must be injected into every
		// worker created by initWorker.
		registerWorkerTsSupport();
	});

	it("transports the precompiled WebAssembly.Module without shelling it", async () => {
		const wasmPath = path.join(
			path.dirname(require.resolve("koishipro-core.js")),
			"vendor/wasm_cjs/libocgcore.wasm",
		);
		const wasmModule = await WebAssembly.compile(await fs.promises.readFile(wasmPath));

		const options = await makeWorkerOptions(wasmModule);

		const worker = await initWorker(OcgcoreWorker, options);
		try {
			// Behavior assertion (primary): the worker instantiated the shared
			// module and can drive the duel.
			const result = await worker.process();
			expect(result.raw.length).toBeGreaterThan(0);
		} finally {
			await worker.finalize();
		}

		// Auxiliary assertion: the module arrives in the worker as a real
		// WebAssembly.Module (a shelled {} would fail this and crash init).
		const probe = await initWorker(OcgcoreModuleProbeWorker, {
			ygoproPaths: [],
			extraScriptPaths: [],
			cardStorage: undefined as unknown as CardStorage,
			ocgcoreWasmModule: wasmModule,
			seed: [],
			hostinfo: HOST_INFO,
			decks: [],
			registry: {},
		});
		try {
			expect(await probe.wasmModuleIsReal()).toBe(true);
		} finally {
			await probe.finalize();
		}
	});

	it("rejects worker init within a bounded time for a corrupt module", async () => {
		const corruptModule = buildCorruptModule();
		const options = await makeWorkerOptions(corruptModule);

		let timeout: NodeJS.Timeout | undefined;
		const boundedInit = Promise.race([
			initWorker(OcgcoreWorker, options),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error("worker init did not fail within the bounded time")),
					10_000,
				);
			}),
		]);

		try {
			await expect(boundedInit).rejects.toThrow();
		} finally {
			if (timeout) {
				clearTimeout(timeout);
			}
		}
	});
});
