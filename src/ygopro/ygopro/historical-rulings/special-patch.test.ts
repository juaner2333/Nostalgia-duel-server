import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOcgcoreWrapper, DirScriptReaderEx, OcgcoreMessageType } from "koishipro-core.js";
import initSqlJs from "sql.js";
import { YGOProCdb } from "ygopro-cdb-encode";
import { HistoricalRulingsDriver, RESOURCE_ROOT } from "@test-support/wasm/HistoricalRulingsDriver";
import { CardStorage } from "@ygopro/ygopro/card-storage";
import { resolveFormatPreloadScriptPaths } from "@ygopro/ygopro/ResourcePoolResolver";
import { readWhitelistCardIds } from "@ygopro/ygopro/YGOProResourceLoader";
import {
	IdleCmdType,
	OcgcoreScriptConstants as C,
	YGOProMsgNewTurn,
	YGOProMsgRetry,
	YGOProMsgSelectCard,
} from "ygopro-msg-encode";

// Boots sql.js + the ocgcore WASM once per format: with parallel workers that
// easily outruns Jest's 5s default without being a real failure.
jest.setTimeout(60_000);

const SANGAN = 26202165; // クリッター: searches on "sent from the field to the grave"
const JUDGMENT = 41420027; // 神の宣告: negates a flip summon
const MONSTER_REBORN = 83764718; // 死者蘇生
const RYKO = 21502796; // ライトロード・ハンター ライコウ (flip monster)
const FODDER = 70095154; // サイバー・ドラゴン

/**
 * Negates a flip summon of the sangan with Solemn Judgment and optionally
 * revives the sangan afterwards. Returns the observed select-card prompts
 * (a sangan search would appear as one) and the final monster zone.
 */
async function runNegatedFlipScenario(options: { withSpecial: boolean; revive: boolean }): Promise<{
	selectCardPrompts: number;
	mzone: Array<number | undefined>;
	grave: Array<number | undefined>;
}> {
	let driver: HistoricalRulingsDriver;
	if (options.withSpecial) {
		driver = await HistoricalRulingsDriver.create("1103");
	} else {
		// format script dir minus special.lua, so the patch is absent
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "no-special-"));
		const srcDir = path.join(RESOURCE_ROOT, "ygopro", "formats", "1103", "script");
		for (const name of fs.readdirSync(srcDir)) {
			if (name !== "special.lua") {
				fs.copyFileSync(path.join(srcDir, name), path.join(tmp, name));
			}
		}
		driver = await HistoricalRulingsDriver.createWithScriptDirs("1103", [
			tmp,
			path.join(RESOURCE_ROOT, "ygopro", "base"),
		]);
	}
	const duel = driver.createDuel();
	duel.place(0, {
		hand: [SANGAN, ...(options.revive ? [MONSTER_REBORN] : []), FODDER, FODDER, FODDER, FODDER],
	});
	duel.place(1, { szone: [{ code: JUDGMENT }] });
	duel.place(1, { mzone: [{ code: FODDER }] });
	duel.idleAction = (msg) => {
		if (duel.turnPlayer === 1) {
			return msg.prepareResponse(IdleCmdType.TO_EP);
		}
		const mset = msg.msetableCards.find((a) => a.code === SANGAN);
		if (mset) {
			return msg.prepareResponse(IdleCmdType.MSET, mset);
		}
		const flip = msg.reposableCards.find((a) => a.code === SANGAN);
		if (flip) {
			return msg.prepareResponse(IdleCmdType.REPOS, flip);
		}
		const reborn = msg.activatableCards.find((a) => a.code === MONSTER_REBORN);
		if (reborn) {
			return msg.prepareResponse(IdleCmdType.ACTIVATE, reborn);
		}
		return msg.prepareResponse(IdleCmdType.TO_EP);
	};
	duel.selectChainIndex = (msg) => {
		const judgment = msg.chains.findIndex((chain) => chain.code === JUDGMENT);
		return judgment === -1 ? null : judgment;
	};
	let selectCardPrompts = 0;
	duel.selectCardIndices = (msg) => {
		selectCardPrompts++;
		const sangan = msg.cards.findIndex(
			(card) => card.code === SANGAN && card.location === C.LOCATION_GRAVE,
		);
		return [sangan === -1 ? 0 : sangan];
	};
	duel.start();
	let newTurns = 0;
	duel.runUntil((msg) => {
		if (msg instanceof YGOProMsgNewTurn) newTurns++;
		if (msg instanceof YGOProMsgRetry) {
			throw new Error("unexpected retry in negated flip summon scenario");
		}
		return newTurns >= 5;
	});
	const mzone = duel.queryFieldCards(0, C.LOCATION_MZONE).cards?.map((card) => card.code) ?? [];
	const grave = duel.queryFieldCards(0, C.LOCATION_GRAVE).cards?.map((card) => card.code) ?? [];
	duel.endDuel();
	driver.finalize();
	return { selectCardPrompts, mzone, grave };
}

describe("special.lua global 2011 patch", () => {
	it("does not treat a negated flip summon as sent from the field to the grave", async () => {
		const result = await runNegatedFlipScenario({ withSpecial: true, revive: false });
		// the sangan went to the grave but its "sent from the field" search
		// effect did not trigger, so no select-card prompt appeared
		expect(result.grave).toContain(SANGAN);
		expect(result.selectCardPrompts).toBe(0);
	});

	it("keeps a monster whose flip summon was negated revivable", async () => {
		const result = await runNegatedFlipScenario({ withSpecial: true, revive: true });
		// monster reborn revived the sangan: it sits in the monster zone
		expect(result.mzone).toContain(SANGAN);
	});

	it("preloads special.lua through the production assembly before card scripts load", async () => {
		// c11012887 (ジュラック・グアイバ) calls SetCondition(aux.dserodcon) inside
		// initial_effect, so it can only load when the patch was preloaded.
		// This mirrors the production worker: script chain from the loader and
		// the preload name derived by resolveFormatPreloadScriptPaths.
		const formatPath = path.join(RESOURCE_ROOT, "ygopro", "formats", "1103");
		const basePath = path.join(RESOURCE_ROOT, "ygopro", "base");
		const preloadName = resolveFormatPreloadScriptPaths(formatPath)[0];
		expect(preloadName).toBe("script/special.lua");

		const loadErrors = async (preload: boolean): Promise<string[]> => {
			const SQL = await initSqlJs();
			const cdb = new YGOProCdb(
				new SQL.Database(fs.readFileSync(path.join(RESOURCE_ROOT, "ygopro", "base", "cards.cdb"))),
			).noTexts();
			const baseStorage = CardStorage.fromCards(cdb.step());
			cdb.finalize();
			const pool = await readWhitelistCardIds(
				path.join(RESOURCE_ROOT, "ygopro", "formats", "1103", "lflist.conf"),
			);
			const storage = baseStorage.filterForFormat(pool);
			const wrapper = await createOcgcoreWrapper();
			const errors: string[] = [];
			wrapper.setMessageHandler(
				async (_duel: unknown, message: string, type: OcgcoreMessageType) => {
					if (type === OcgcoreMessageType.ScriptError) {
						errors.push(message);
					}
				},
			);
			wrapper.setScriptReader(await DirScriptReaderEx(formatPath, basePath));
			wrapper.setCardReader(storage.toCardReader());
			const duel = wrapper.createDuelV2([1, 2, 3, 4]);
			duel.setPlayerInfo({ player: 0, lp: 8000, startHand: 0, drawCount: 1 });
			duel.setPlayerInfo({ player: 1, lp: 8000, startHand: 0, drawCount: 1 });
			if (preload) {
				duel.preloadScript(preloadName!);
			}
			duel.newCard({
				code: 11012887,
				owner: 0,
				player: 0,
				location: C.LOCATION_DECK,
				sequence: 0,
				position: C.POS_FACEDOWN_DEFENSE,
			});
			wrapper.finalize();
			return errors;
		};

		// with the production preload the card script loads cleanly
		expect(await loadErrors(true)).toEqual([]);
		// without it the patch API is missing and the card script fails to load
		const withoutPreload = await loadErrors(false);
		expect(
			withoutPreload.some((message) => message.includes('Parameter 2 should be "Function"')),
		).toBe(true);
	});

	it("provides Card.GetFlipEffect and Auxiliary.dserodcon before card scripts load", async () => {
		// a card script that asserts the patch APIs exist and that the flip
		// effect registry works; this only succeeds when special.lua was
		// preloaded before the card script was loaded
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "special-patch-"));
		const scriptDir = path.join(RESOURCE_ROOT, "ygopro", "formats", "1103", "script");
		const custom = fs.readFileSync(path.join(scriptDir, "c21502796.lua"), "utf8");
		const lines = custom.split(/\r?\n/);
		const out: string[] = [];
		let inInitial = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith("function c21502796.initial_effect")) {
				inInitial = true;
			}
			if (inInitial && trimmed === "end") {
				out.push(
					'\tif type(Auxiliary.dserodcon) ~= "function" then error("Auxiliary.dserodcon missing") end',
					'\tif type(Card.GetFlipEffect) ~= "function" then error("Card.GetFlipEffect missing") end',
					'\tif c:GetFlipEffect() == nil then error("flip effect not collected") end',
				);
				out.push(line);
				inInitial = false;
				continue;
			}
			out.push(line);
		}
		fs.writeFileSync(path.join(tmp, "c21502796.lua"), out.join("\n"));

		const loadErrors = async (withSpecial: boolean): Promise<string[]> => {
			fs.rmSync(path.join(tmp, "special.lua"), { force: true });
			if (withSpecial) {
				fs.copyFileSync(path.join(scriptDir, "special.lua"), path.join(tmp, "special.lua"));
			}
			const SQL = await initSqlJs();
			const cdb = new YGOProCdb(
				new SQL.Database(fs.readFileSync(path.join(RESOURCE_ROOT, "ygopro", "base", "cards.cdb"))),
			).noTexts();
			const baseStorage = CardStorage.fromCards(cdb.step());
			cdb.finalize();
			const pool = await readWhitelistCardIds(
				path.join(RESOURCE_ROOT, "ygopro", "formats", "1103", "lflist.conf"),
			);
			const storage = baseStorage.filterForFormat(pool);
			const wrapper = await createOcgcoreWrapper();
			const errors: string[] = [];
			wrapper.setMessageHandler(
				async (_duel: unknown, message: string, type: OcgcoreMessageType) => {
					if (type === OcgcoreMessageType.ScriptError) {
						errors.push(message);
					}
				},
			);
			wrapper.setScriptReader(
				await DirScriptReaderEx(tmp, path.join(RESOURCE_ROOT, "ygopro", "base")),
			);
			wrapper.setCardReader(storage.toCardReader());
			const duel = wrapper.createDuelV2([1, 2, 3, 4]);
			duel.setPlayerInfo({ player: 0, lp: 8000, startHand: 0, drawCount: 1 });
			duel.setPlayerInfo({ player: 1, lp: 8000, startHand: 0, drawCount: 1 });
			if (withSpecial) {
				duel.preloadScript("special.lua");
			}
			duel.newCard({
				code: RYKO,
				owner: 0,
				player: 0,
				location: C.LOCATION_DECK,
				sequence: 0,
				position: C.POS_FACEDOWN_DEFENSE,
			});
			wrapper.finalize();
			return errors;
		};

		try {
			// with the patch preloaded the script runs cleanly
			expect(await loadErrors(true)).toEqual([]);
			// without the patch the card script cannot resolve the API
			const withoutSpecial = await loadErrors(false);
			expect(
				withoutSpecial.some((message) => message.includes("Auxiliary.dserodcon missing")),
			).toBe(true);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
