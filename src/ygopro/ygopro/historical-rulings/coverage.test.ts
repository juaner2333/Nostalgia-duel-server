import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { HistoricalRulingsDriver, RESOURCE_ROOT } from "@test-support/wasm/HistoricalRulingsDriver";
import { readWhitelistCardIds } from "@ygopro/ygopro/YGOProResourceLoader";
import { IdleCmdType, YGOProMsgDamage } from "ygopro-msg-encode";

/**
 * The card IDs covered by 2011 rulings in both 1103 and 1109 for this
 * change: the first batch minus 5861892 (kept on modern rulings) plus
 * 47355498 necrovalley. The remaining spec candidates stay on base scripts.
 */
export const HISTORICAL_RULINGS_CARD_IDS = [
	95727991, 26202165, 50321796, 88264978, 70583986, 25862681, 96782886, 77565204, 21502796,
	80168720, 16226786, 47355498,
];

const formatScriptDir = (formatId: string) =>
	path.join(RESOURCE_ROOT, "ygopro", "formats", formatId, "script");

const sha256 = (content: Buffer): string =>
	crypto.createHash("sha256").update(content).digest("hex");

describe("historical card rulings coverage", () => {
	it("covers the 27 spec card IDs in both format script dirs with identical content", () => {
		for (const formatId of ["1103", "1109"]) {
			const dir = formatScriptDir(formatId);
			const files = fs.readdirSync(dir).filter((name) => name.endsWith(".lua"));
			expect(files.sort()).toEqual(HISTORICAL_RULINGS_CARD_IDS.map((id) => `c${id}.lua`).sort());
		}
		const digests1103 = new Map(
			HISTORICAL_RULINGS_CARD_IDS.map((id) => [
				id,
				sha256(fs.readFileSync(path.join(formatScriptDir("1103"), `c${id}.lua`))),
			]),
		);
		for (const id of HISTORICAL_RULINGS_CARD_IDS) {
			const digest1109 = sha256(fs.readFileSync(path.join(formatScriptDir("1109"), `c${id}.lua`)));
			expect(digest1109).toBe(digests1103.get(id));
		}
	});

	it("keeps every covered card inside the fixed base database and both whitelists", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		try {
			const pool1103 = await readWhitelistCardIds(
				path.join(RESOURCE_ROOT, "ygopro", "formats", "1103", "lflist.conf"),
			);
			const pool1109 = await readWhitelistCardIds(
				path.join(RESOURCE_ROOT, "ygopro", "formats", "1109", "lflist.conf"),
			);
			for (const id of HISTORICAL_RULINGS_CARD_IDS) {
				expect(driver.storage.readCard(id)).toBeDefined();
				expect(pool1103.has(id)).toBe(true);
				expect(pool1109.has(id)).toBe(true);
			}
		} finally {
			driver.finalize();
		}
	});

	it("reads only the current format's script dir and falls back to base, never the other format", async () => {
		// A modified catapult turtle script deals full attack as damage instead of half.
		const baseScript = fs.readFileSync(
			path.join(RESOURCE_ROOT, "ygopro", "base", "script", "c95727991.lua"),
			"utf8",
		);
		const modified = baseScript.replace(
			"math.floor(sg:GetFirst():GetAttack()/2)",
			"sg:GetFirst():GetAttack()",
		);
		expect(modified).not.toBe(baseScript);

		const tmp1103 = fs.mkdtempSync(path.join(os.tmpdir(), "hist-1103-"));
		const tmp1109 = fs.mkdtempSync(path.join(os.tmpdir(), "hist-1109-"));
		// 1109 gets the modified script; 1103 does not have it at all.
		fs.writeFileSync(path.join(tmp1109, "c95727991.lua"), modified);

		const driver1103 = await HistoricalRulingsDriver.createWithScriptDirs("1103", [
			tmp1103,
			path.join(RESOURCE_ROOT, "ygopro", "base"),
		]);
		const driver1109 = await HistoricalRulingsDriver.createWithScriptDirs("1109", [
			tmp1109,
			path.join(RESOURCE_ROOT, "ygopro", "base"),
		]);
		const duel1103 = driver1103.createDuel();
		const duel1109 = driver1109.createDuel();

		const setupCatapult = (duel: typeof duel1103) => {
			duel.place(0, {
				mzone: [{ code: 95727991 }, { code: 70095154 }],
				hand: [70095154, 70095154, 70095154, 70095154, 70095154],
			});
			duel.place(1, { mzone: [{ code: 70095154 }] });
			duel.idleAction = (msg) => {
				const activatable = msg.activatableCards.find((a) => a.code === 95727991);
				return activatable
					? msg.prepareResponse(IdleCmdType.ACTIVATE, activatable)
					: msg.prepareResponse(IdleCmdType.TO_EP);
			};
			duel.selectCardIndex = (msg) => {
				if (msg.cards.length > 1) {
					const fodder = msg.cards.findIndex((c) => c.code !== 95727991);
					if (fodder !== -1) return fodder;
				}
				return 0;
			};
			duel.start();
		};

		try {
			setupCatapult(duel1103);
			setupCatapult(duel1109);
			const damage1103 = collectFirstCatapultDamage(duel1103);
			const damage1109 = collectFirstCatapultDamage(duel1109);
			// base behavior: half of the released monster's attack (2100/2 = 1050)
			expect(damage1103).toBe(1050);
			// the tagged 1109 script: full attack (2100)
			expect(damage1109).toBe(2100);
		} finally {
			duel1103.endDuel();
			duel1109.endDuel();
			driver1103.finalize();
			driver1109.finalize();
			fs.rmSync(tmp1103, { recursive: true, force: true });
			fs.rmSync(tmp1109, { recursive: true, force: true });
		}
	});
});

function collectFirstCatapultDamage(duel: {
	runUntil: (until: (msg: unknown) => boolean) => unknown[];
}): number {
	let damage = 0;
	duel.runUntil((msg) => {
		if (msg instanceof YGOProMsgDamage) {
			damage = msg.value;
			return true;
		}
		return false;
	});
	return damage;
}
