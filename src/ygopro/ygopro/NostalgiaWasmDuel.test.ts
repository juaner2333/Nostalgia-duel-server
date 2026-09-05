import fs from "node:fs";
import path from "node:path";
import { createOcgcoreWrapper, DirScriptReaderEx } from "koishipro-core.js";
import initSqlJs from "sql.js";
import { YGOProCdb } from "ygopro-cdb-encode";
import { OcgcoreScriptConstants } from "ygopro-msg-encode";
import { calculateDuelOptions } from "@ygopro/utils/calculate-duel-options";
import { CardStorage } from "./card-storage";
import { readWhitelistCardIds } from "./YGOProResourceLoader";

// Boots sql.js + the ocgcore WASM once per format: with parallel workers that
// easily outruns Jest's 5s default without being a real failure.
jest.setTimeout(60_000);

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const RESOURCE_ROOT = path.join(PROJECT_ROOT, "nostalgia-resources");

function allowedScriptedCard(formatPath: string, basePath: string, cardIds: Set<number>): number {
	const limits = new Map<number, number>();
	for (const line of fs
		.readFileSync(path.join(formatPath, "lflist.conf"), "utf-8")
		.split(/\r?\n/)) {
		const match = /^(\d+)\s+([0-3])(?:\s|$)/.exec(line.trim());
		if (match) {
			limits.set(Number(match[1]), Number(match[2]));
		}
	}
	const cardId = [...cardIds].find(
		(id) => limits.get(id) === 3 && fs.existsSync(path.join(basePath, "script", `c${id}.lua`)),
	);
	if (!cardId) {
		throw new Error(`No unrestricted scripted card in ${formatPath}`);
	}
	return cardId;
}

describe("fixed nostalgia WASM duels", () => {
	it("starts one stock-WASM duel per format and rejects a 1109-only card from 1103", async () => {
		const SQL = await initSqlJs();
		const cdb = new YGOProCdb(
			new SQL.Database(fs.readFileSync(path.join(RESOURCE_ROOT, "ygopro", "base", "cards.cdb"))),
		).noTexts();
		const baseStorage = CardStorage.fromCards(cdb.step());
		cdb.finalize();
		const pool1103 = await readWhitelistCardIds(
			path.join(RESOURCE_ROOT, "ygopro", "formats", "1103", "lflist.conf"),
		);
		const pool1109 = await readWhitelistCardIds(
			path.join(RESOURCE_ROOT, "ygopro", "formats", "1109", "lflist.conf"),
		);
		const only1109 = [...pool1109].find((cardId) => !pool1103.has(cardId));
		expect(only1109).toBeDefined();
		expect(baseStorage.filterByCardIds(pool1103).readCard(only1109!)).toBeUndefined();
		expect(baseStorage.filterByCardIds(pool1109).readCard(only1109!)).toBeDefined();

		for (const formatId of ["1103", "1109"]) {
			const formatPath = path.join(RESOURCE_ROOT, "ygopro", "formats", formatId);
			const basePath = path.join(RESOURCE_ROOT, "ygopro", "base");
			const cardId = allowedScriptedCard(
				formatPath,
				basePath,
				formatId === "1103" ? pool1103 : pool1109,
			);
			const cardStorage = baseStorage.filterByCardIds(formatId === "1103" ? pool1103 : pool1109);
			const wrapper = await createOcgcoreWrapper();

			try {
				wrapper.setScriptReader(await DirScriptReaderEx(formatPath, basePath));
				wrapper.setCardReader(cardStorage.toCardReader());
				const duel = wrapper.createDuelV2([1, 2, 3, 4]);
				for (const player of [0, 1]) {
					duel.setPlayerInfo({ player, lp: 8000, startHand: 5, drawCount: 1 });
					for (let index = 0; index < 40; index++) {
						duel.newCard({
							code: cardId,
							owner: player,
							player,
							location: OcgcoreScriptConstants.LOCATION_DECK,
							sequence: 0,
							position: OcgcoreScriptConstants.POS_FACEDOWN_DEFENSE,
						});
					}
				}
				duel.startDuel(
					calculateDuelOptions({
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
					}),
				);
				expect(duel.process({ noParse: true }).raw.length).toBeGreaterThan(0);
				duel.endDuel();
			} finally {
				wrapper.finalize();
			}
		}
	});
});
