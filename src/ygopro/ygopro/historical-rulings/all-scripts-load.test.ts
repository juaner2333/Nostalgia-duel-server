import fs from "node:fs";
import path from "node:path";
import {
	createOcgcoreWrapper,
	DirScriptReaderEx,
	_OcgcoreConstants,
	OcgcoreMessageType,
} from "koishipro-core.js";
import initSqlJs from "sql.js";
import { YGOProCdb } from "ygopro-cdb-encode";
import { CardStorage } from "@ygopro/ygopro/card-storage";
import { readWhitelistCardIds } from "@ygopro/ygopro/YGOProResourceLoader";
import { RESOURCE_ROOT } from "@test-support/wasm/HistoricalRulingsDriver";

const { OcgcoreScriptConstants: C } = _OcgcoreConstants;

/**
 * Loads every card script of a format plus its special.lua in a real ocgcore
 * WASM duel through the production load path: special.lua is preloaded first
 * (mirroring the worker init order), then every scripted card is added to the
 * duel, which triggers `load_card_script` and runs `initial_effect`. Any
 * syntax error or unavailable construct surfaces as a ScriptError message.
 */
describe("historical rulings: all format scripts load in the real engine", () => {
	it.each([
		"1103",
		"1109",
	] as const)("loads every %s script without script errors", async (formatId) => {
		const formatPath = path.join(RESOURCE_ROOT, "ygopro", "formats", formatId);
		const basePath = path.join(RESOURCE_ROOT, "ygopro", "base");
		const scriptDir = path.join(formatPath, "script");
		const scripts = fs.readdirSync(scriptDir).filter((name) => name.endsWith(".lua"));
		expect(scripts.length).toBe(formatId === "1103" ? 377 : 378);
		expect(scripts).toContain("special.lua");
		const cardIds = scripts
			.filter((name) => /^c\d+\.lua$/.test(name))
			.map((name) => Number(name.slice(1, -4)))
			.sort((a, b) => a - b);
		expect(cardIds.length).toBe(formatId === "1103" ? 376 : 377);

		const SQL = await initSqlJs();
		const cdb = new YGOProCdb(
			new SQL.Database(fs.readFileSync(path.join(RESOURCE_ROOT, "ygopro", "base", "cards.cdb"))),
		).noTexts();
		const baseStorage = CardStorage.fromCards(cdb.step());
		cdb.finalize();
		const pool = await readWhitelistCardIds(
			path.join(RESOURCE_ROOT, "ygopro", "formats", formatId, "lflist.conf"),
		);
		const storage = baseStorage.filterForFormat(pool);

		const wrapper = await createOcgcoreWrapper();
		const scriptErrors: string[] = [];
		wrapper.setMessageHandler(async (_duel: unknown, message: string, type: OcgcoreMessageType) => {
			if (type === OcgcoreMessageType.ScriptError) {
				scriptErrors.push(message);
			}
		});
		wrapper.setScriptReader(await DirScriptReaderEx(formatPath, basePath));
		wrapper.setCardReader(storage.toCardReader());
		try {
			const duel = wrapper.createDuelV2([1, 2, 3, 4]);
			duel.setPlayerInfo({ player: 0, lp: 8000, startHand: 0, drawCount: 1 });
			duel.setPlayerInfo({ player: 1, lp: 8000, startHand: 0, drawCount: 1 });
			duel.preloadScript("special.lua");
			for (const [index, code] of cardIds.entries()) {
				duel.newCard({
					code,
					owner: 0,
					player: 0,
					location: C.LOCATION_DECK,
					sequence: index,
					position: C.POS_FACEDOWN_DEFENSE,
				});
			}
			expect(scriptErrors).toEqual([]);
		} finally {
			wrapper.finalize();
		}
	});
});
