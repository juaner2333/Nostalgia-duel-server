import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { readCdbCardIds } from "./NostalgiaResourceGenerator";
import { readWhitelistCardIds } from "./YGOProResourceLoader";

const RESOURCE_ROOT = path.resolve(__dirname, "../../..", "nostalgia-resources");
const PATCH_CSV = path.resolve(__dirname, "../../..", "patches", "nostalgia-setcode-patch.csv");
const BASE_CDB = path.join(RESOURCE_ROOT, "ygopro", "base", "cards.cdb");
const LOCK_JSON = path.join(RESOURCE_ROOT, "lock.json");

/** 六武众 / 剑斗兽 / 地缚神的新版高位 archetype 编码（锁定脚本契约） */
const SETCODE_SIX_SAMURAI = 0x103d;
const SETCODE_GLADIATOR_BEAST = 0x1019;
const SETCODE_EARTHBOUND_IMMORTAL = 0x1021;
/** 荷鲁斯 LV 系列以 0x119d 作为 16 位单元 */
const SETCODE_HORUS = 0x119d;
/** 魅惑女王 LV 系列最低 16 位为 0x3 */
const SETCODE_ALLURE_QUEEN = 0x3;

const EXPECTED_PATCH_ROWS = 136;
const EXPECTED_BASE_COUNT = 5399;
const EXPECTED_POOL_COUNTS: Record<string, number> = { "1103": 5198, "1109": 5320 };

interface PatchRow {
	cardId: number;
	oldSetcode: number;
	newSetcode: number;
	name: string;
}

function readPatchRows(): PatchRow[] {
	const lines = fs.readFileSync(PATCH_CSV, "utf-8").trim().split(/\r?\n/);
	const [header, ...body] = lines;
	if (header !== "card_id,old_setcode,new_setcode,card_name") {
		throw new Error(`unexpected patch CSV header: ${header}`);
	}
	return body.map((line) => {
		const [cardId, oldSetcode, newSetcode, name] = line.split(",");
		const row: PatchRow = {
			cardId: Number(cardId),
			oldSetcode: Number(oldSetcode),
			newSetcode: Number(newSetcode),
			name: name ?? "",
		};
		return row;
	});
}

async function readCurrentSetcodes(): Promise<Map<number, number>> {
	const SQL = await initSqlJs();
	const database = new SQL.Database(fs.readFileSync(BASE_CDB));
	try {
		const query = database.exec("SELECT id, setcode FROM datas")[0];
		return new Map(query.values.map(([id, setcode]) => [Number(id), Number(setcode)]));
	} finally {
		database.close();
	}
}

async function readDatasAndTextsCounts(): Promise<{ datas: number; texts: number }> {
	const SQL = await initSqlJs();
	const database = new SQL.Database(fs.readFileSync(BASE_CDB));
	try {
		const counts = { datas: 0, texts: 0 };
		for (const table of ["datas", "texts"] as const) {
			counts[table] = Number(database.exec(`SELECT COUNT(*) FROM ${table}`)[0].values[0][0]);
		}
		return counts;
	} catch {
		throw new Error("CDB schema is not the expected datas/texts structure");
	} finally {
		database.close();
	}
}

function containsSetcodeUnit(value: number, unit: number): boolean {
	return (value & 0xffff) === unit || ((value >>> 16) & 0xffff) === unit;
}

function cardPoolSha256(cardIds: Set<number>): string {
	return createHash("sha256")
		.update([...cardIds].sort((left, right) => left - right).join("\n"))
		.update("\n")
		.digest("hex");
}

describe("nostalgia setcode compatibility patch", () => {
	it("has exactly 136 unique ascending common-card rows in the patch CSV", () => {
		const rows = readPatchRows();
		expect(rows).toHaveLength(EXPECTED_PATCH_ROWS);
		const ids = rows.map((row) => row.cardId);
		expect(new Set(ids).size).toBe(EXPECTED_PATCH_ROWS);
		expect(ids).toEqual([...ids].sort((a, b) => a - b));
		for (const row of rows) {
			expect(Number.isInteger(row.oldSetcode)).toBe(true);
			expect(Number.isInteger(row.newSetcode)).toBe(true);
			expect(row.oldSetcode).toBeGreaterThanOrEqual(0);
			expect(row.newSetcode).toBeGreaterThanOrEqual(0);
			expect(row.oldSetcode).not.toBe(row.newSetcode);
			expect(row.name.length).toBeGreaterThan(0);
		}
	});

	it("has every patched setcode group expected by the locked scripts", () => {
		const rows = readPatchRows();
		const byOldNew = new Map<string, number>();
		for (const row of rows) {
			const key = `${row.oldSetcode}->${row.newSetcode}`;
			byOldNew.set(key, (byOldNew.get(key) ?? 0) + 1);
		}
		expect(byOldNew.get(`${0x19}->${SETCODE_GLADIATOR_BEAST}`)).toBe(29);
		expect(byOldNew.get(`${0x3d}->${SETCODE_SIX_SAMURAI}`)).toBe(22);
		expect(byOldNew.get(`${0x21}->${SETCODE_EARTHBOUND_IMMORTAL}`)).toBe(9);
		expect(byOldNew.get(`${0x41}->${0x119d0041}`)).toBe(3);
		expect(byOldNew.get(`${0x41}->${0x410003}`)).toBe(3);
	});

	it("keeps every patch target inside the current CDB with an old or applied value", async () => {
		const rows = readPatchRows();
		const setcodes = await readCurrentSetcodes();
		for (const row of rows) {
			const current = setcodes.get(row.cardId);
			expect(current).toBeDefined();
			// unknown third values are forbidden: only the audited old or new encoding may exist
			expect(current === row.oldSetcode || current === row.newSetcode).toBe(true);
		}
	});

	it("stores the new encoding for every patch target in the applied CDB", async () => {
		const rows = readPatchRows();
		const setcodes = await readCurrentSetcodes();
		for (const row of rows) {
			expect(setcodes.get(row.cardId)).toBe(row.newSetcode);
		}
	});

	it("keeps the 14 local alt-art codes with setcode inherited from their alias base cards", async () => {
		// 14 codes exist only in the fixed CDB (not in any upstream CDB), so the
		// patch tool must mirror their alias base card's setcode onto them.
		const LOCAL_ONLY_ALT_ART_IDS = [
			33396951, 38033120, 46986409, 46986410, 46986411, 46986412, 46986413, 89631133, 89631134,
			89631135, 89631136, 89631137, 89631138, 97268404,
		];
		const SQL = await initSqlJs();
		const database = new SQL.Database(fs.readFileSync(BASE_CDB));
		try {
			const rows = database.exec("SELECT id, alias, setcode FROM datas ORDER BY id ASC")[0].values;
			const byId = new Map(rows.map(([id, , setcode]) => [Number(id), Number(setcode)]));
			const aliasById = new Map(rows.map(([id, alias]) => [Number(id), Number(alias)]));
			const idSet = new Set(byId.keys());
			for (const cardId of LOCAL_ONLY_ALT_ART_IDS) {
				expect(byId.has(cardId)).toBe(true);
				const aliasId = aliasById.get(cardId) ?? 0;
				expect(aliasId).not.toBe(0);
				expect(idSet.has(aliasId)).toBe(true);
				expect(byId.get(cardId)).toBe(byId.get(aliasId));
			}
			// none of them may appear in the common-card patch list
			const patchIds = new Set(readPatchRows().map((row) => row.cardId));
			for (const cardId of LOCAL_ONLY_ALT_ART_IDS) {
				expect(patchIds.has(cardId)).toBe(false);
			}
		} finally {
			database.close();
		}
	});

	it("keeps 5399 datas and texts rows with the locked card ID set", async () => {
		const counts = await readDatasAndTextsCounts();
		expect(counts.datas).toBe(EXPECTED_BASE_COUNT);
		expect(counts.texts).toBe(EXPECTED_BASE_COUNT);
		const lock = JSON.parse(fs.readFileSync(LOCK_JSON, "utf-8"));
		expect(lock.inputs.baseDatabase.count).toBe(EXPECTED_BASE_COUNT);
		expect(cardPoolSha256(new Set(await readCdbCardIds(BASE_CDB)))).toBe(
			lock.inputs.baseDatabase.cardIdsSha256,
		);
	});

	it("keeps the 1103 and 1109 whitelist card pools at 5198 / 5320 with locked ID sets", async () => {
		const lock = JSON.parse(fs.readFileSync(LOCK_JSON, "utf-8"));
		for (const formatId of ["1103", "1109"]) {
			const cardIds = await readWhitelistCardIds(
				path.join(RESOURCE_ROOT, "ygopro", "formats", formatId, "lflist.conf"),
			);
			expect(cardIds.size).toBe(EXPECTED_POOL_COUNTS[formatId]);
			expect(cardPoolSha256(cardIds)).toBe(lock.formats[formatId].cardPool.cardIdsSha256);
		}
	});

	it("stores the new-style archetype encodings for representative cards", async () => {
		const setcodes = await readCurrentSetcodes();
		// 六武众的影武者 / 剑斗兽 网斗 / 地缚神 卡帕克·阿普
		expect(setcodes.get(1498130)).toBe(SETCODE_SIX_SAMURAI);
		expect(setcodes.get(612115)).toBe(SETCODE_GLADIATOR_BEAST);
		expect(setcodes.get(46263076)).toBe(SETCODE_EARTHBOUND_IMMORTAL);
		// 荷鲁斯之黑炎龙 LV4 携带 0x119d 单元
		expect(containsSetcodeUnit(setcodes.get(75830094) ?? 0, SETCODE_HORUS)).toBe(true);
		// 魅惑的女王 LV5 携带 0x3 单元
		expect(containsSetcodeUnit(setcodes.get(23756165) ?? 0, SETCODE_ALLURE_QUEEN)).toBe(true);
	});
});
