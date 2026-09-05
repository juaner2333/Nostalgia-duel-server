import path from "node:path";

import { readWhitelistCardIds } from "./YGOProResourceLoader";

const RESOURCE_ROOT = path.resolve(__dirname, "../../../nostalgia-resources");

const lflistPath = (formatId: string): string =>
	path.join(RESOURCE_ROOT, "ygopro", "formats", formatId, "lflist.conf");

/** 不属于 OCG 2011.09 卡池的卡（lflist.conf 末尾 EXCLUDED 注释块同步记录）。 */
const EXCLUDED_FROM_1109: ReadonlyArray<readonly [number, string]> = [
	[43096270, "紫翠玉龙"],
	[80495985, "光子剑齿虎"],
	[16480084, "进化龙 蜥结龙"],
	[42874792, "发条兔"],
	[79279397, "D 少年组"],
	[15667446, "暗黑界的斗神 拉齐那"],
	[42752141, "进化帝 蛙颌翼龙"],
	[78156759, "发条机雷 发条雷"],
	[4545854, "超量领域"],
	[41930553, "暗黑瘴气"],
];

/** 不属于 OCG 2011.03 卡池的卡。 */
const EXCLUDED_FROM_1103: ReadonlyArray<readonly [number, string]> = [[43096270, "紫翠玉龙"]];

describe("nostalgia card pool exclusions", () => {
	it.each(EXCLUDED_FROM_1109)("keeps %s %s out of the 1109 card pool", async (cardId, name) => {
		const pool = await readWhitelistCardIds(lflistPath("1109"));

		expect(pool.has(cardId)).toBe(false);
		expect(name.length).toBeGreaterThan(0);
	});

	it.each(EXCLUDED_FROM_1103)("keeps %s %s out of the 1103 card pool", async (cardId, name) => {
		const pool = await readWhitelistCardIds(lflistPath("1103"));

		expect(pool.has(cardId)).toBe(false);
		expect(name.length).toBeGreaterThan(0);
	});

	it("keeps the exclusion lists free of duplicates", () => {
		for (const list of [EXCLUDED_FROM_1103, EXCLUDED_FROM_1109]) {
			const cardIds = list.map(([cardId]) => cardId);
			expect(new Set(cardIds).size).toBe(cardIds.length);
		}
	});
});
