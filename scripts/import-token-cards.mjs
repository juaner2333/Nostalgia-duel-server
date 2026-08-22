#!/usr/bin/env node
/**
 * 将 1103/1109 脚本引用的 token 虚拟卡元数据导入固定基础 CDB。
 *
 * 用法：
 *   node scripts/import-token-cards.mjs \
 *     --cdb nostalgia-resources/ygopro/base/cards.cdb \
 *     --source /path/to/upstream-cards.cdb \
 *     --script-dir nostalgia-resources/ygopro/base/script \
 *     --script-dir nostalgia-resources/ygopro/formats/1103/script \
 *     --script-dir nostalgia-resources/ygopro/formats/1109/script
 *
 * 数据来源：上游官方 ygopro 卡数据库（本项目采用 purerosefallen/ygopro
 * 的 cards.cdb，https://raw.githubusercontent.com/purerosefallen/ygopro/master/cards.cdb）。
 * 仅提取脚本引用的 token 卡行；ot 按本地惯例修正为 3。
 *
 * 导入后必须重新生成资源锁（npm run generate:nostalgia-lock）并评审差异。
 * 引擎侧契约：Duel.CreateToken / IsPlayerCanSpecialSummonMonster 需要从卡阅读器
 * 读取 token 卡数据；CardStorage.filterForFormat 会在格式过滤时保留 TYPE_TOKEN 卡。
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";

const TYPE_TOKEN = 0x4000;

const CREATE_TOKEN_REFERENCE = /Duel\.CreateToken\(\s*(?:tp|1-tp)\s*,\s*(\d+)(?:\s*\+\s*i)?\s*\)/g;
const TOKEN_LOOP = /for\s+i\s*=\s*(\d+)\s*,\s*(\d+)\s*do/g;
const TOKEN_SUMMON_MONSTER_REFERENCE =
	/Duel\.IsPlayerCanSpecialSummonMonster\(\s*(?:tp|1-tp)\s*,\s*(\d+)[\s\S]*?TYPES_TOKEN_MONSTER/g;

function extractTokenCodes(luaText) {
	const codes = new Set();
	const loops = [];
	for (const match of luaText.matchAll(TOKEN_LOOP)) {
		loops.push({
			first: Number(match[1]),
			last: Number(match[2]),
			begin: match.index ?? 0,
			finish: (match.index ?? 0) + match[0].length,
		});
	}
	for (const match of luaText.matchAll(CREATE_TOKEN_REFERENCE)) {
		const base = Number(match[1]);
		if (!match[0].match(/\+\s*i/)) {
			codes.add(base);
			continue;
		}
		const loop = [...loops]
			.filter((candidate) => candidate.finish <= (match.index ?? 0))
			.sort((left, right) => right.begin - left.begin)[0];
		if (!loop) continue;
		for (let i = loop.first; i <= loop.last; i++) codes.add(base + i);
	}
	for (const match of luaText.matchAll(TOKEN_SUMMON_MONSTER_REFERENCE)) {
		codes.add(Number(match[1]));
	}
	return codes;
}

async function walkLuaFiles(directory, files = []) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			await walkLuaFiles(entryPath, files);
		} else if (entry.isFile() && entry.name.endsWith(".lua")) {
			files.push(entryPath);
		}
	}
	return files;
}

function parseArgs(argv) {
	const args = { scriptDirs: [] };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--cdb" || arg === "--source") {
			const value = argv[++index];
			if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
			args[arg.slice(2)] = path.resolve(value);
		} else if (arg === "--script-dir") {
			const value = argv[++index];
			if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
			args.scriptDirs.push(path.resolve(value));
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	if (!args.cdb || !args.source || args.scriptDirs.length === 0) {
		throw new Error("required: --cdb, --source, at least one --script-dir");
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));

const SQL = await initSqlJs();
const target = new SQL.Database(await readFile(args.cdb));
const source = new SQL.Database(await readFile(args.source));

const tokenIds = new Set();
for (const scriptDir of args.scriptDirs) {
	for (const file of await walkLuaFiles(scriptDir)) {
		for (const code of extractTokenCodes(await readFile(file, "utf-8"))) {
			tokenIds.add(code);
		}
	}
}

const existing = new Set(target.exec("SELECT id FROM datas")[0].values.map(([id]) => id));
const conflicts = [...tokenIds].filter((id) => existing.has(id));
if (conflicts.length > 0) {
	throw new Error(
		`target CDB already contains token card IDs: ${conflicts.sort((a, b) => a - b).join(", ")}`,
	);
}

const datasQuery = source.exec(
	`SELECT id, ot, alias, setcode, type, atk, def, level, race, attribute, category
	 FROM datas WHERE id IN (${[...tokenIds].join(",")})`,
)[0];
const textsQuery = source.exec(
	`SELECT id, name, desc, str1, str2, str3, str4, str5, str6, str7, str8, str9,
	        str10, str11, str12, str13, str14, str15, str16
	 FROM texts WHERE id IN (${[...tokenIds].join(",")})`,
)[0];
const sourceDataRows = new Map(datasQuery.values.map((row) => [row[0], row]));
const sourceTextRows = new Map(textsQuery.values.map((row) => [row[0], row]));

const missing = [...tokenIds].filter((id) => !sourceDataRows.has(id));
if (missing.length > 0) {
	throw new Error(
		`source CDB is missing token card data: ${missing.sort((a, b) => a - b).join(", ")}`,
	);
}

const insertDatas = target.prepare(
	"INSERT INTO datas (id, ot, alias, setcode, type, atk, def, level, race, attribute, category) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
);
for (const id of [...tokenIds].sort((a, b) => a - b)) {
	const row = sourceDataRows.get(id);
	if ((row[4] & TYPE_TOKEN) === 0) {
		throw new Error(`source card ${id} is not a token (type=0x${row[4].toString(16)})`);
	}
	insertDatas.run([id, 3, row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10]]);
}
insertDatas.free();

const insertTexts = target.prepare(
	`INSERT INTO texts (id, name, desc, str1, str2, str3, str4, str5, str6, str7,
	 str8, str9, str10, str11, str12, str13, str14, str15, str16)
	 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
);
for (const id of [...tokenIds].sort((a, b) => a - b)) {
	const row = sourceTextRows.get(id);
	if (!row) {
		throw new Error(`source CDB is missing token text for card ${id}`);
	}
	insertTexts.run(row);
}
insertTexts.free();

await writeFile(args.cdb, Buffer.from(target.export()));

const verify = new SQL.Database(await readFile(args.cdb));
const count = verify.exec("SELECT count(*) FROM datas")[0].values[0][0];
const tokenCount = verify.exec(`SELECT count(*) FROM datas WHERE (type & ${TYPE_TOKEN}) != 0`)[0]
	.values[0][0];
const sample = verify.exec("SELECT name FROM texts WHERE id=44330099")[0]?.values[0]?.[0];
console.log(`imported ${tokenIds.size} token cards (total datas: ${count}, tokens: ${tokenCount})`);
console.log(`sample: 44330099 -> ${sample}`);
