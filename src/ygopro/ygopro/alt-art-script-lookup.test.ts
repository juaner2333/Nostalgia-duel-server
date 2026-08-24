import fs from "node:fs";
import path from "node:path";
import { createOcgcoreWrapper, DirScriptReaderEx, _OcgcoreConstants } from "koishipro-core.js";
import initSqlJs from "sql.js";
import { YGOProCdb } from "ygopro-cdb-encode";
import { CardStorage } from "@ygopro/ygopro/card-storage";
import { readWhitelistCardIds } from "@ygopro/ygopro/YGOProResourceLoader";
import { RESOURCE_ROOT } from "@test-support/wasm/HistoricalRulingsDriver";

const { OcgcoreScriptConstants: C } = _OcgcoreConstants;

/**
 * Alternate-art cards (code = base + small offset, e.g. 70095155 -> 70095154)
 * have no script of their own in the fixed resource tree. The ocgcore WASM must
 * fall back to the base card's script via the card's `alias`, otherwise the
 * alt-art card would be vanilla in a duel. This test proves that fallback on
 * the real engine through the production script chain (format -> base).
 */
const ALT_ART_CASES: Array<[alt: number, base: number]> = [
	[70095155, 70095154], // 电子龙 / Cyber Dragon
	[10802916, 10802915], // 由魔界到现世的死亡导游 / Tour Guide
	[44508095, 44508094], // 星尘龙 / Stardust Dragon
	[97077564, 97077563], // 活死人的呼声 / Call of the Haunted
	[97268403, 97268402], // 效果遮蒙者 / Effect Veiler
	[83764719, 83764718], // 死者苏生 / Monster Reborn
];

describe("alternate-art cards resolve to their base script in the real engine", () => {
	it("requests the base card script (alias fallback) when an alt-art card is placed", async () => {
		const formatId = "1109";
		const formatPath = path.join(RESOURCE_ROOT, "ygopro", "formats", formatId);
		const basePath = path.join(RESOURCE_ROOT, "ygopro", "base");

		const SQL = await initSqlJs();
		const cdb = new YGOProCdb(
			new SQL.Database(fs.readFileSync(path.join(RESOURCE_ROOT, "ygopro", "base", "cards.cdb"))),
		).noTexts();
		const baseStorage = CardStorage.fromCards(cdb.step());
		cdb.finalize();
		const pool = await readWhitelistCardIds(path.join(formatPath, "lflist.conf"));
		const storage = baseStorage.filterForFormat(pool);

		const wrapper = await createOcgcoreWrapper();
		const requested: string[] = [];
		// spy reader records every path, then falls through to the real reader
		wrapper.setScriptReader((scriptPath: string) => {
			requested.push(scriptPath);
			return null;
		}, true);
		wrapper.setScriptReader(await DirScriptReaderEx(formatPath, basePath));
		wrapper.setCardReader(storage.toCardReader());
		try {
			for (const [alt, base] of ALT_ART_CASES) {
				// sanity: the base card has a script in the fixed tree
				expect(fs.existsSync(path.join(basePath, "script", `c${base}.lua`))).toBe(true);

				requested.length = 0;
				const duel = wrapper.createDuelV2([1, 2, 3, 4]);
				duel.setPlayerInfo({ player: 0, lp: 8000, startHand: 0, drawCount: 1 });
				duel.setPlayerInfo({ player: 1, lp: 8000, startHand: 0, drawCount: 1 });
				duel.newCard({
					code: alt,
					owner: 0,
					player: 0,
					location: C.LOCATION_DECK,
					sequence: 0,
					position: C.POS_FACEDOWN_DEFENSE,
				});
				duel.startDuel(0);
				for (let index = 0; index < 40; index += 1) {
					try {
						duel.process();
					} catch {
						// the engine may settle the duel; script loading already happened
						break;
					}
				}
				duel.endDuel();

				const normalized = new Set(requested.map((p) => p.replace(/^\.\/script\//, "")));
				// the alt-art code triggers the BASE card's script, not a missing c{alt}.lua
				expect(normalized.has(`c${base}.lua`)).toBe(true);
			}
		} finally {
			wrapper.finalize();
		}
	});
});
