import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";
import { YGOProLFListItem } from "ygopro-lflist-encode";
import { scanTokenCodes } from "./token-script-scanner";

const MIN_CARD_ID = 1;
const MAX_CARD_ID = 0x7fffffff;
const ALLOWED_FORMAT_IDS = new Set(["1103", "1109"]);

/** 固定环境的卡池数量契约：基础数据库（5120 实卡 + 79 个脚本引用 token）与 1103/1109 白名单的唯一规模。 */
export const EXPECTED_NOSTALGIA_POOL_SIZES: Readonly<Record<string, number>> = Object.freeze({
	base: 5199,
	"1103": 5002,
	"1109": 5120,
});
/** ygopro TYPE_TOKEN 位：CDB 中带该位的卡是脚本生成 token 所需的虚拟卡元数据 */
const TYPE_TOKEN = 0x4000;
const SCRIPT_SOURCE = {
	repository: "https://github.com/Fluorohydride/ygopro-scripts",
	commit: "090e881772f488e1256c456b827d5cbed4facf79",
};

export interface ValidatedWhitelist {
	cardIds: Set<number>;
	quantities: Map<number, number>;
	hash: number;
	sha256: string;
}

export interface ValidateLfListFileOptions {
	cdbPath: string;
	lflistPath: string;
}

interface CardPoolSummary {
	count: number;
	cardIdsSha256: string;
}

interface ScriptSummary {
	fileCount: number;
	sha256: string;
}

interface NostalgiaResourceLock {
	schemaVersion: 1;
	inputs: {
		baseDatabase: CardPoolSummary & {
			path: string;
			sha256: string;
			invalidCardIds: number[];
			duplicateCardIds: number[];
		};
	};
	formats: Record<
		string,
		{
			cardPool: CardPoolSummary;
			lflist: { path: string; hash: number; sha256: string };
			scripts: ScriptSummary & { source: { repository: string; commit: string } };
		}
	>;
	scripts: {
		base: ScriptSummary & {
			source: { repository: string; commit: string };
			selection: {
				cardScriptFilenamePattern: string;
				cardScriptCount: number;
				missingCardScriptIds: number[];
				commonScripts: string[];
			};
		};
	};
}

export async function readCdbCardIds(cdbPath: string): Promise<number[]> {
	const SQL = await initSqlJs();
	const database = new SQL.Database(await readFile(cdbPath));
	try {
		const query = database.exec("SELECT id FROM datas ORDER BY id ASC")[0];
		if (!query) {
			throw new Error(`CDB ${cdbPath} has no datas rows`);
		}

		const ids = query.values.map(([id]) => parseCardId(id, "CDB"));
		assertUnique(ids, "CDB");
		return ids;
	} finally {
		database.close();
	}
}

/** CDB 中所有 token 虚拟卡的 ID（type 含 TYPE_TOKEN 位） */
export async function readCdbTokenIds(cdbPath: string): Promise<number[]> {
	const SQL = await initSqlJs();
	const database = new SQL.Database(await readFile(cdbPath));
	try {
		const query = database.exec("SELECT id, type FROM datas ORDER BY id ASC")[0];
		if (!query) {
			throw new Error(`CDB ${cdbPath} has no datas rows`);
		}

		const ids = query.values
			.filter(([, type]) => Number(type) > 0 && (Number(type) & TYPE_TOKEN) !== 0)
			.map(([id]) => parseCardId(id, "CDB token"));
		assertUnique(ids, "CDB token");
		return ids;
	} finally {
		database.close();
	}
}

export function validateWhitelist(text: string, expectedCardIds: Set<number>): ValidatedWhitelist {
	const validated = parseWhitelist(text);
	if (!sameCardIds(validated.cardIds, expectedCardIds)) {
		throw new Error("whitelist card pool mismatch");
	}
	return validated;
}

export async function validateLfListFile(
	options: ValidateLfListFileOptions,
): Promise<ValidatedWhitelist> {
	const baseCardIds = new Set(await readCdbCardIds(options.cdbPath));
	return validateFormatWhitelist(await readFile(options.lflistPath, "utf-8"), baseCardIds);
}

function parseWhitelist(text: string): ValidatedWhitelist {
	if (!text.includes("$whitelist")) {
		throw new Error("whitelist marker missing");
	}

	const cardIds = new Set<number>();
	const quantities = new Map<number, number>();
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#") || line.startsWith("!") || line.startsWith("$")) {
			continue;
		}
		const match = /^(\d+)\s+(\d+)(?:\s|$)/.exec(line);
		if (!match) {
			throw new Error(`invalid whitelist entry: ${line}`);
		}
		const cardId = parseCardId(match[1], "whitelist");
		const quantity = Number(match[2]);
		if (!Number.isInteger(quantity) || quantity < 0 || quantity > 3) {
			throw new Error(`invalid whitelist quantity: ${quantity}`);
		}
		if (cardIds.has(cardId)) {
			throw new Error(`duplicate whitelist card ID: ${cardId}`);
		}
		cardIds.add(cardId);
		quantities.set(cardId, quantity);
	}

	return {
		cardIds,
		quantities,
		hash: new YGOProLFListItem().fromText(text).getHash(),
		sha256: createHash("sha256").update(text).digest("hex"),
	};
}

export async function writeNostalgiaResourceLock(
	resourceRoot: string,
	lockPath: string,
): Promise<void> {
	const lock = await buildNostalgiaResourceLock(resourceRoot);
	await writeFile(lockPath, `${JSON.stringify(lock, null, "\t")}\n`, "utf-8");
}

export async function checkNostalgiaResourceLock(
	resourceRoot: string,
	lockPath: string,
): Promise<void> {
	await checkNostalgiaResourceBoundaries(resourceRoot);
	let actual: string;
	try {
		actual = await readFile(lockPath, "utf-8");
	} catch (error) {
		throw new Error(`resource lock missing: ${lockPath}: ${String(error)}`);
	}
	const built = await buildNostalgiaResourceLock(resourceRoot);
	const expected = `${JSON.stringify(built, null, "\t")}\n`;
	if (actual !== expected) {
		throw new Error(`resource lock drift: ${lockPath}`);
	}
	assertFixedPoolSizes(built);
}

/**
 * 断言 lock 中的卡池数量与固定环境契约一致（基础 5120 实卡 + 79 token、1103 5002、1109 5120），
 * 防止错误资源配合重新生成的 lock 通过门禁。
 */
export function assertFixedPoolSizes(lock: {
	inputs: { baseDatabase: { count: number } };
	formats: Record<string, { cardPool: { count: number } }>;
}): void {
	if (lock.inputs.baseDatabase.count !== EXPECTED_NOSTALGIA_POOL_SIZES.base) {
		throw new Error(
			`base card pool mismatch: expected ${EXPECTED_NOSTALGIA_POOL_SIZES.base}, got ${lock.inputs.baseDatabase.count}`,
		);
	}
	for (const formatId of ALLOWED_FORMAT_IDS) {
		const actual = lock.formats[formatId]?.cardPool.count;
		if (actual !== EXPECTED_NOSTALGIA_POOL_SIZES[formatId]) {
			throw new Error(
				`format ${formatId} card pool mismatch: expected ${EXPECTED_NOSTALGIA_POOL_SIZES[formatId]}, got ${actual}`,
			);
		}
	}
}

/**
 * 校验资源根只包含固定布局（白名单），拒绝任何越界内容：
		if (actual !== EXPECTED_NOSTALGIA_POOL_SIZES[formatId]) {
			throw new Error(
				`format ${formatId} card pool mismatch: expected ${EXPECTED_NOSTALGIA_POOL_SIZES[formatId]}, got ${actual}`,
			);
		}
	}
}

/**
 * 校验资源根只包含固定布局（白名单），拒绝任何越界内容：
 *
 *   <root>/
 *   ├── lock.json
 *   └── ygopro/
 *       ├── base/{cards.cdb, script/*.lua}
 *       └── formats/{1103,1109}/{lflist.conf, script/*.lua}
 *
 * script 目录只允许 .lua 文件与 .gitkeep（git 空目录占位），不允许子目录；
 * 其余任何条目（EDOPro 树、未启用赛制、外部脚本树、仓库缓存等）都拒绝。
 */
export async function checkNostalgiaResourceBoundaries(resourceRoot: string): Promise<void> {
	const ygoproDir = path.join(resourceRoot, "ygopro");
	const baseDir = path.join(ygoproDir, "base");
	const formatsDir = path.join(ygoproDir, "formats");

	await expectEntries(
		resourceRoot,
		new Map([
			["lock.json", "file"],
			["ygopro", "dir"],
		]),
		"resource",
	);
	await expectEntries(
		ygoproDir,
		new Map([
			["base", "dir"],
			["formats", "dir"],
		]),
		"ygopro",
	);
	await expectEntries(
		baseDir,
		new Map([
			["cards.cdb", "file"],
			["script", "dir"],
		]),
		"base",
	);
	await expectEntries(
		formatsDir,
		new Map([
			["1103", "dir"],
			["1109", "dir"],
		]),
		"formats",
	);

	for (const formatId of ALLOWED_FORMAT_IDS) {
		const formatDir = path.join(formatsDir, formatId);
		await expectEntries(
			formatDir,
			new Map([
				["lflist.conf", "file"],
				["script", "dir"],
			]),
			`format ${formatId}`,
		);
		await expectScriptDirectory(path.join(formatDir, "script"));
	}
	await expectScriptDirectory(path.join(baseDir, "script"));
}

async function expectEntries(
	directory: string,
	allowed: Map<string, "file" | "dir">,
	label: string,
): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const expectedType = allowed.get(entry.name);
		const ok =
			expectedType === "file"
				? entry.isFile()
				: expectedType === "dir"
					? entry.isDirectory()
					: false;
		if (!ok) {
			throw new Error(`unexpected ${label} entry: ${entry.name}`);
		}
	}
}

async function expectScriptDirectory(scriptDirectory: string): Promise<void> {
	for (const entry of await readdir(scriptDirectory, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			throw new Error(`unexpected script subdirectory: ${entry.name}`);
		}
		if (!entry.isFile() || (!entry.name.endsWith(".lua") && entry.name !== ".gitkeep")) {
			throw new Error(`unexpected script file: ${entry.name}`);
		}
	}
}

function parseCardId(value: unknown, source: string): number {
	const cardId = Number(value);
	if (!Number.isInteger(cardId) || cardId < MIN_CARD_ID || cardId > MAX_CARD_ID) {
		throw new Error(`invalid ${source} card ID: ${String(value)}`);
	}
	return cardId;
}

function assertUnique(ids: number[], source: string): void {
	if (new Set(ids).size !== ids.length) {
		throw new Error(`duplicate ${source} card ID`);
	}
}

function sameCardIds(left: Set<number>, right: Set<number>): boolean {
	return left.size === right.size && [...left].every((cardId) => right.has(cardId));
}

async function buildNostalgiaResourceLock(resourceRoot: string): Promise<NostalgiaResourceLock> {
	const baseDatabasePath = path.join(resourceRoot, "ygopro", "base", "cards.cdb");
	const baseCardIds = new Set(await readCdbCardIds(baseDatabasePath));
	const baseTokenIds = new Set(await readCdbTokenIds(baseDatabasePath));
	const baseScriptDirectory = path.join(resourceRoot, "ygopro", "base", "script");
	const baseScriptSelection = await summarizeBaseScriptSelection(baseScriptDirectory, baseCardIds);

	// token 元数据完整性：脚本引用的 token 必须存在于基础 CDB，且 CDB 中不得
	// 存在脚本未引用的多余 token（防止 token 缺失再次静默破坏 token 生成）。
	const scriptTokenIds = await scanTokenCodes([
		path.join(resourceRoot, "ygopro", "formats", "1103", "script"),
		path.join(resourceRoot, "ygopro", "formats", "1109", "script"),
		baseScriptDirectory,
	]);
	const missingTokens = [...scriptTokenIds].filter((cardId) => !baseTokenIds.has(cardId));
	if (missingTokens.length > 0) {
		throw new Error(
			`script token references missing from base CDB: ${missingTokens.sort((a, b) => a - b).join(", ")}`,
		);
	}
	const extraTokens = [...baseTokenIds].filter((cardId) => !scriptTokenIds.has(cardId));
	if (extraTokens.length > 0) {
		throw new Error(
			`base CDB token cards not referenced by scripts: ${extraTokens.sort((a, b) => a - b).join(", ")}`,
		);
	}

	const formats = Object.fromEntries(
		await Promise.all(
			(["1103", "1109"] as const).map(async (formatId) => {
				const lflistPath = path.join(resourceRoot, "ygopro", "formats", formatId, "lflist.conf");
				const validated = validateFormatWhitelist(await readFile(lflistPath, "utf-8"), baseCardIds);
				const scripts = await summarizeScripts(
					path.join(resourceRoot, "ygopro", "formats", formatId, "script"),
				);
				return [
					formatId,
					{
						cardPool: summarizeCardPool(validated.cardIds),
						lflist: {
							path: relativePath(resourceRoot, lflistPath),
							hash: validated.hash,
							sha256: validated.sha256,
						},
						scripts: { ...scripts, source: SCRIPT_SOURCE },
					},
				] as const;
			}),
		),
	) as NostalgiaResourceLock["formats"];

	return {
		schemaVersion: 1,
		inputs: {
			baseDatabase: {
				path: relativePath(resourceRoot, baseDatabasePath),
				sha256: await hashFile(baseDatabasePath),
				...summarizeCardPool(baseCardIds),
				invalidCardIds: [],
				duplicateCardIds: [],
			},
		},
		formats,
		scripts: {
			base: {
				...(await summarizeScripts(baseScriptDirectory)),
				source: SCRIPT_SOURCE,
				selection: baseScriptSelection,
			},
		},
	};
}

function validateFormatWhitelist(text: string, baseCardIds: Set<number>): ValidatedWhitelist {
	const validated = parseWhitelist(text);
	assertSubset(validated.cardIds, baseCardIds, "format whitelist");
	return validated;
}

function assertSubset(candidate: Set<number>, base: Set<number>, description: string): void {
	const outside = [...candidate].filter((cardId) => !base.has(cardId));
	if (outside.length > 0) {
		throw new Error(
			`${description} contains database-external card IDs: ${outside.sort().join(", ")}`,
		);
	}
}

function summarizeCardPool(cardIds: Set<number>): CardPoolSummary {
	return {
		count: cardIds.size,
		cardIdsSha256: createHash("sha256")
			.update([...cardIds].sort((left, right) => left - right).join("\n"))
			.update("\n")
			.digest("hex"),
	};
}

async function summarizeScripts(scriptDirectory: string): Promise<ScriptSummary> {
	const files = await listLuaFiles(scriptDirectory);
	const entries = await Promise.all(
		files.map(
			async (filePath) => `${relativePath(scriptDirectory, filePath)}:${await hashFile(filePath)}`,
		),
	);
	return {
		fileCount: files.length,
		sha256: createHash("sha256").update(entries.sort().join("\n")).update("\n").digest("hex"),
	};
}

async function summarizeBaseScriptSelection(
	scriptDirectory: string,
	baseCardIds: Set<number>,
): Promise<NostalgiaResourceLock["scripts"]["base"]["selection"]> {
	const files = await listLuaFiles(scriptDirectory);
	const filenames = new Set(files.map((filePath) => path.basename(filePath)));
	const commonScripts = ["constant.lua", "procedure.lua", "utility.lua"];
	for (const filename of commonScripts) {
		if (!filenames.has(filename)) {
			throw new Error(`required base script missing: ${filename}`);
		}
	}
	const cardScriptIds = new Set(
		files
			.map((filePath) => /^c(\d+)\.lua$/.exec(path.basename(filePath))?.[1])
			.filter((id): id is string => id !== undefined)
			.map(Number),
	);
	return {
		cardScriptFilenamePattern: "c<cardId>.lua",
		cardScriptCount: cardScriptIds.size,
		missingCardScriptIds: [...baseCardIds]
			.filter((cardId) => !cardScriptIds.has(cardId))
			.sort((left, right) => left - right),
		commonScripts,
	};
}

async function listLuaFiles(directory: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listLuaFiles(entryPath)));
		} else if (entry.isFile() && entry.name.endsWith(".lua")) {
			files.push(entryPath);
		}
	}
	return files;
}

async function hashFile(filePath: string): Promise<string> {
	return createHash("sha256")
		.update(await readFile(filePath))
		.digest("hex");
}

function relativePath(root: string, target: string): string {
	return path.relative(root, target).split(path.sep).join("/");
}
