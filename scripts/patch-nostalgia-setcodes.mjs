#!/usr/bin/env node
/**
 * 严格、事务化、幂等的 CDB setcode 数据补丁工具。
 *
 * 用途：将固定 base CDB 的 `datas.setcode` 同步到与锁定 Fluorohydride Lua
 * 脚本配套的新版 archetype 编码（见 `plan-doc/nostalgia-setcode-compatibility-fix.md`
 * 与 `patches/nostalgia-setcode-patch.csv`）。
 *
 * 用法：
 *   node scripts/patch-nostalgia-setcodes.mjs \
 *     [--cdb nostalgia-resources/ygopro/base/cards.cdb] \
 *     [--csv patches/nostalgia-setcode-patch.csv]
 *
 * 行为契约：
 * 1. 校验 CDB schema 仅包含预期的 datas/texts 结构；
 * 2. 校验 CSV header、行数、唯一 ID 与十进制数值格式；
 * 3. 每个 patch ID 必须同时存在于 datas 与 texts；
 * 4. 当前值等于 old_setcode 时更新为 new_setcode；
 * 5. 当前值已等于 new_setcode 时跳过（幂等）；
 * 6. 当前值为其他值时立即失败，不覆盖未知状态；
 * 7. 所有更新在单一事务内执行，任一失败全部回滚；
 * 8. 共同卡更新后，将 alias 指向共同卡（或任何 CDB 内卡）的本地卡 setcode
 *    同步为 alias 原卡的最终值（本地独有异画码继承机制，未命中为无操作）；
 * 9. 前后结构化对比在事务内、写盘前完成：只允许 datas.setcode 变化，ID 集合、
 *    记录数、其余 datas 字段与全部 texts 字段必须零变化；对比通过后才 COMMIT
 *    并原子替换目标文件，任一失败则回滚且磁盘保持原状。
 *
 * 成功后必须重新生成资源锁（npm run generate:nostalgia-lock）并评审差异。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";

const DEFAULT_CDB = path.resolve("nostalgia-resources/ygopro/base/cards.cdb");
const DEFAULT_CSV = path.resolve("patches/nostalgia-setcode-patch.csv");

/** 人工审核的共同卡 setcode 转换行数（与 patches/nostalgia-setcode-patch.csv 一致）；
 * 卡池或清单变更时必须同步更新。 */
const EXPECTED_PATCH_ROWS = 136;

const EXPECTED_TABLES = new Map([
	[
		"datas",
		"CREATE TABLE datas(id integer primary key,ot integer,alias integer,setcode integer,type integer,atk integer,def integer,level integer,race integer,attribute integer,category integer)",
	],
	[
		"texts",
		"CREATE TABLE texts(id integer primary key,name text,desc text,str1 text,str2 text,str3 text,str4 text,str5 text,str6 text,str7 text,str8 text,str9 text,str10 text,str11 text,str12 text,str13 text,str14 text,str15 text,str16 text)",
	],
]);

const DATAS_FIELDS = [
	"ot",
	"alias",
	"setcode",
	"type",
	"atk",
	"def",
	"level",
	"race",
	"attribute",
	"category",
];
const TEXTS_FIELDS = [
	"name",
	"desc",
	"str1",
	"str2",
	"str3",
	"str4",
	"str5",
	"str6",
	"str7",
	"str8",
	"str9",
	"str10",
	"str11",
	"str12",
	"str13",
	"str14",
	"str15",
	"str16",
];

function parseArguments(argv) {
	const args = { cdb: DEFAULT_CDB, csv: DEFAULT_CSV };
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === "--cdb") args.cdb = path.resolve(argv[++index]);
		else if (argv[index] === "--csv") args.csv = path.resolve(argv[++index]);
	}
	return args;
}

function readCsv(csvPath) {
	const text = readFileSyncSafe(csvPath);
	const lines = text.trim().split(/\r?\n/);
	if (lines.length === 0 || lines[0] !== "card_id,old_setcode,new_setcode,card_name") {
		throw new Error(`CSV ${csvPath} header mismatch`);
	}
	const rows = [];
	const seen = new Set();
	for (const [lineIndex, line] of lines.slice(1).entries()) {
		const fields = line.split(",");
		if (fields.length !== 4) {
			throw new Error(`CSV line ${lineIndex + 2} must have exactly 4 fields`);
		}
		const [cardIdText, oldText, newText] = fields;
		if (!/^\d+$/.test(cardIdText) || !/^\d+$/.test(oldText) || !/^\d+$/.test(newText)) {
			throw new Error(`CSV line ${lineIndex + 2} has non-decimal values`);
		}
		const cardId = Number(cardIdText);
		const oldSetcode = Number(oldText);
		const newSetcode = Number(newText);
		if (
			!Number.isSafeInteger(cardId) ||
			!Number.isSafeInteger(oldSetcode) ||
			!Number.isSafeInteger(newSetcode)
		) {
			throw new Error(`CSV line ${lineIndex + 2} has values outside the safe integer range`);
		}
		if (seen.has(cardId)) {
			throw new Error(`CSV has duplicate card_id ${cardId}`);
		}
		seen.add(cardId);
		rows.push({ cardId, oldSetcode, newSetcode, name: fields[3] });
	}
	if (rows.length !== EXPECTED_PATCH_ROWS) {
		throw new Error(
			`CSV ${csvPath} has ${rows.length} rows, expected exactly ${EXPECTED_PATCH_ROWS}`,
		);
	}
	return rows;
}

function readFileSyncSafe(p) {
	try {
		return readFileSync(p, "utf-8");
	} catch {
		throw new Error(`cannot read ${p}`);
	}
}

function checkSchema(database) {
	const tables = new Map();
	for (const row of database.exec("SELECT name, sql FROM sqlite_master WHERE type='table'")[0]
		.values) {
		tables.set(row[0], row[1]);
	}
	if (tables.size !== EXPECTED_TABLES.size) {
		throw new Error(`CDB has unexpected tables: ${[...tables.keys()].join(", ")}`);
	}
	for (const [name, sql] of EXPECTED_TABLES) {
		if (tables.get(name) !== sql) {
			throw new Error(`CDB table ${name} schema mismatch`);
		}
	}
	const auxObjects = database.exec("SELECT type, name FROM sqlite_master WHERE type != 'table'")[0];
	if (auxObjects && auxObjects.values.length > 0) {
		throw new Error(
			`CDB has unexpected ${auxObjects.values.map((row) => row[0] + ":" + row[1]).join(", ")}`,
		);
	}
}

function snapshot(database) {
	const datas = new Map();
	for (const row of database.exec(`SELECT id, ${DATAS_FIELDS.join(", ")} FROM datas`)[0].values) {
		datas.set(
			Number(row[0]),
			row.slice(1).map((value) => Number(value)),
		);
	}
	const texts = new Map();
	for (const row of database.exec(`SELECT id, ${TEXTS_FIELDS.join(", ")} FROM texts`)[0].values) {
		texts.set(Number(row[0]), row.slice(1));
	}
	return { datas, texts };
}

function summarizeSnapshot(snapshot) {
	return {
		datas: snapshot.datas.size,
		texts: snapshot.texts.size,
		idSha256: createSha256([...snapshot.datas.keys()]),
	};
}

function createSha256(ids) {
	return createHash("sha256")
		.update([...ids].sort((a, b) => a - b).join("\n"))
		.update("\n")
		.digest("hex");
}

async function main() {
	const { cdb, csv } = parseArguments(process.argv.slice(2));
	const rows = readCsv(csv);
	const SQL = await initSqlJs();
	const database = new SQL.Database(await readFile(cdb));
	try {
		checkSchema(database);
		const before = snapshot(database);
		const summary = summarizeSnapshot(before);

		const patchById = new Map(rows.map((row) => [row.cardId, row]));
		for (const row of rows) {
			if (!before.datas.has(row.cardId) || !before.texts.has(row.cardId)) {
				throw new Error(`patch card ${row.cardId} (${row.name}) missing from datas or texts`);
			}
		}

		let updated = 0;
		let skipped = 0;
		// 补丁前快照的 setcode 视图，贯穿整个事务：共同卡更新后同步维护，
		// 保证 alias 继承读取的是“最终值”（原卡若同时在 CSV 中被更新则取新值）。
		const currentSetcode = new Map(
			[...before.datas].map(([cardId, record]) => [cardId, record[2]]),
		);
		database.run("BEGIN");
		try {
			for (const row of rows) {
				const current = before.datas.get(row.cardId);
				if (current[2] === row.newSetcode) {
					skipped++;
					continue;
				}
				if (current[2] !== row.oldSetcode) {
					throw new Error(
						`card ${row.cardId} (${row.name}) has setcode ${current[2]}, expected ${row.oldSetcode} or ${row.newSetcode}`,
					);
				}
				database.run("UPDATE datas SET setcode = ? WHERE id = ?", [row.newSetcode, row.cardId]);
				currentSetcode.set(row.cardId, row.newSetcode);
				updated++;
			}

			// 本地独有异画码继承：alias 指向 CDB 内卡的本地卡，其 setcode 必须与
			// alias 原卡的最终值一致；清单共同卡无条件保持 CSV 值。
			let inherited = 0;
			for (const [cardId, record] of before.datas) {
				if (patchById.has(cardId)) continue;
				const alias = record[1];
				if (alias === 0 || !before.datas.has(alias)) continue;
				const baseSetcode = currentSetcode.get(alias);
				if (record[2] !== baseSetcode) {
					database.run("UPDATE datas SET setcode = ? WHERE id = ?", [baseSetcode, cardId]);
					currentSetcode.set(cardId, baseSetcode);
					inherited++;
				}
			}

			// 结构化对比在事务内、写盘前执行：任何 invariant 破坏都会回滚，
			// 磁盘文件保持原状。
			const after = snapshot(database);
			const invariants = {
				"card ID set": summary.idSha256 === summarizeSnapshot(after).idSha256 ? 0 : -1,
				"datas rows": summary.datas === after.datas.size ? 0 : -1,
				"texts rows": summary.texts === after.texts.size ? 0 : -1,
				"datas non-setcode fields": 0,
				"texts fields": 0,
			};
			for (const [cardId, record] of after.datas) {
				const beforeRecord = before.datas.get(cardId);
				for (let index = 0; index < DATAS_FIELDS.length; index++) {
					if (index === 2) continue;
					if (beforeRecord[index] !== record[index]) invariants["datas non-setcode fields"]++;
				}
			}
			for (const [cardId, record] of after.texts) {
				const beforeRecord = before.texts.get(cardId);
				for (let index = 0; index < TEXTS_FIELDS.length; index++) {
					if (beforeRecord[index] !== record[index]) invariants["texts fields"]++;
				}
			}
			for (const [label, count] of Object.entries(invariants)) {
				if (count !== 0) {
					throw new Error(`post-patch invariant broken: ${label} changed ${count} times`);
				}
			}

			database.run("COMMIT");
			// 校验全部通过后才落盘；先写同目录临时文件再 rename，原子替换目标。
			const output = Buffer.from(database.export());
			const tmpPath = `${cdb}.tmp`;
			await writeFile(tmpPath, output);
			await rename(tmpPath, cdb);
			console.log(`applied updates: ${updated}`);
			console.log(`already applied (skipped): ${skipped}`);
			console.log(`alt-art alias inheritance: ${inherited}`);
			const afterSummary = summarizeSnapshot(after);
			for (const [label, count] of Object.entries(invariants)) {
				console.log(`${label}: ${count} changed`);
			}
			console.log(`final datas records: ${afterSummary.datas}`);
			console.log(`final card ID sha256: ${afterSummary.idSha256}`);
		} catch (error) {
			database.run("ROLLBACK");
			throw error;
		}
	} finally {
		database.close();
	}
}

main().catch((error) => {
	process.stderr.write(`${error.message ?? error}\n`);
	process.exitCode = 1;
});
