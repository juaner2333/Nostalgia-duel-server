import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { HistoricalRulingsDriver, RESOURCE_ROOT } from "@test-support/wasm/HistoricalRulingsDriver";
import { readWhitelistCardIds } from "@ygopro/ygopro/YGOProResourceLoader";
import { IdleCmdType, YGOProMsgDamage } from "ygopro-msg-encode";

/**
 * The fixed 2011 coverage set is the upstream `purerosefallen/specials` 706
 * collection (commit f993d739344f1914bcf8c54e90d638eb1fb45d45) filtered by
 * each format whitelist (374 cards for 1103, 375 for 1109) plus the two
 * project-kept cards 80168720 and 96782886; therefore 1103 has exactly 376
 * card scripts and 1109 exactly 377, plus a shared special.lua each.
 */
// Boots sql.js + the ocgcore WASM once per format: with parallel workers that
// easily outruns Jest's 5s default without being a real failure.
jest.setTimeout(60_000);

const EXCLUDED_UPSTREAM_CARD_IDS = [27847700, 57728571, 61468779, 82301904, 83555667, 92661479];
const KEPT_PROJECT_CARD_IDS = [80168720, 96782886];
const COUNT_BY_FORMAT: Record<string, number> = { "1103": 376, "1109": 377 };

const formatScriptDir = (formatId: string) =>
	path.join(RESOURCE_ROOT, "ygopro", "formats", formatId, "script");

const sha256 = (content: Buffer): string =>
	crypto.createHash("sha256").update(content).digest("hex");

const listCardScriptIds = (formatId: string): number[] =>
	fs
		.readdirSync(formatScriptDir(formatId))
		.filter((name) => /^c\d+\.lua$/.test(name))
		.map((name) => Number(name.slice(1, -4)));

describe("historical card rulings coverage", () => {
	it("contains exactly the fixed card script counts plus special.lua per format, byte-identical across formats", () => {
		const idsByFormat = new Map<string, number[]>();
		for (const formatId of ["1103", "1109"]) {
			const files = fs.readdirSync(formatScriptDir(formatId));
			const ids = listCardScriptIds(formatId);
			expect(ids.length).toBe(COUNT_BY_FORMAT[formatId]);
			// exactly one special.lua and no other non-card files
			expect(files.filter((name) => name === "special.lua").length).toBe(1);
			expect(files.filter((name) => /^c\d+\.lua$/.test(name)).length).toBe(ids.length);
			idsByFormat.set(formatId, ids);
		}
		// every shared card ID is byte-identical across the two formats,
		// including the project-kept scripts and special.lua
		const digests1103 = new Map<string, string>();
		for (const name of fs.readdirSync(formatScriptDir("1103"))) {
			digests1103.set(name, sha256(fs.readFileSync(path.join(formatScriptDir("1103"), name))));
		}
		// every shared card ID is byte-identical across the two formats,
		// including the project-kept scripts and special.lua (67750322 is 1109-only)
		const files1109 = fs.readdirSync(formatScriptDir("1109"));
		const only1109 = files1109.filter((name) => !digests1103.has(name));
		expect(only1109).toEqual(["c67750322.lua"]);
		for (const name of files1109.filter((name) => digests1103.has(name))) {
			expect(sha256(fs.readFileSync(path.join(formatScriptDir("1109"), name)))).toBe(
				digests1103.get(name),
			);
		}
		// the kept project cards are present in both environments
		for (const id of KEPT_PROJECT_CARD_IDS) {
			expect(idsByFormat.get("1103")).toContain(id);
			expect(idsByFormat.get("1109")).toContain(id);
		}
		// 67750322 exists only in 1109
		expect(idsByFormat.get("1103")).not.toContain(67750322);
		expect(idsByFormat.get("1109")).toContain(67750322);
	});

	it("keeps every covered card inside the fixed base database and its format whitelist", async () => {
		const driver1103 = await HistoricalRulingsDriver.create("1103");
		const driver1109 = await HistoricalRulingsDriver.create("1109");
		try {
			const pool1103 = await readWhitelistCardIds(
				path.join(RESOURCE_ROOT, "ygopro", "formats", "1103", "lflist.conf"),
			);
			const pool1109 = await readWhitelistCardIds(
				path.join(RESOURCE_ROOT, "ygopro", "formats", "1109", "lflist.conf"),
			);
			for (const formatId of ["1103", "1109"] as const) {
				const pool = formatId === "1103" ? pool1103 : pool1109;
				const storage = formatId === "1103" ? driver1103.storage : driver1109.storage;
				for (const id of listCardScriptIds(formatId)) {
					expect(storage.readCard(id)).toBeDefined();
					expect(pool.has(id)).toBe(true);
				}
			}
			// whitelist-excluded upstream scripts must not be part of any format
			for (const id of EXCLUDED_UPSTREAM_CARD_IDS) {
				expect(fs.existsSync(path.join(formatScriptDir("1103"), `c${id}.lua`))).toBe(false);
				expect(fs.existsSync(path.join(formatScriptDir("1109"), `c${id}.lua`))).toBe(false);
			}
		} finally {
			driver1103.finalize();
			driver1109.finalize();
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
