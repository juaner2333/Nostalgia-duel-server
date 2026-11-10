import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";
import { YGOProLFListItem } from "ygopro-lflist-encode";
import {
	getActiveNostalgiaFormatIds,
	type NostalgiaResourceProfile,
} from "../room/domain/NostalgiaFormat";
import { resolveBaseDatabaseDirectory } from "./ResourcePoolResolver";
import { scanTokenCodes } from "./token-script-scanner";

const GOAT_LIST_HEADER = /^!2005\.0?4\.0?1 W\/O Exarion$/;
const EXARION_UNIVERSE = 63749102;
const MIN_CARD_ID = 1;
const MAX_CARD_ID = 0x7fffffff;
const ALLOWED_FORMAT_IDS = new Set(["1103", "1109"]);

/** 固定环境的卡池数量契约：基础数据库（5320 实卡 + 79 个脚本引用 token）与 1103/1109 白名单的唯一规模。 */
export const EXPECTED_NOSTALGIA_POOL_SIZES: Readonly<Record<string, number>> = Object.freeze({
	base: 5399,
	"1103": 5197,
	"1109": 5310,
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
	if (!text.split(/\r?\n/).some((line) => line.trim() === "$whitelist")) {
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
		sha256: sha256Text(text),
	};
}

export async function writeNostalgiaResourceLock(
	resourceRoot: string,
	lockPath: string,
	profile: NostalgiaResourceProfile = "2011",
): Promise<void> {
	if (profile === "goat") await checkNostalgiaResourceBoundaries(resourceRoot, profile);
	const lock = await buildNostalgiaResourceLock(resourceRoot, profile);
	await writeFile(lockPath, `${JSON.stringify(lock, null, "\t")}\n`, "utf-8");
}

export async function checkNostalgiaResourceLock(
	resourceRoot: string,
	lockPath: string,
	profile: NostalgiaResourceProfile = "2011",
): Promise<void> {
	await checkNostalgiaResourceBoundaries(resourceRoot, profile);
	let actual: string;
	try {
		actual = await readFile(lockPath, "utf-8");
	} catch (error) {
		throw new Error(`resource lock missing: ${lockPath}: ${String(error)}`);
	}
	const built = await buildNostalgiaResourceLock(resourceRoot, profile);
	const expected = `${JSON.stringify(built, null, "\t")}\n`;
	if (actual !== expected) {
		throw new Error(`resource lock drift: ${lockPath}`);
	}
	if (profile === "2011") assertFixedPoolSizes(built);
}

/**
 * 断言 lock 中的卡池数量与固定环境契约一致（基础 5320 实卡 + 79 token、1103 5197、1109 5310），
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
 *       └── formats/
 *           ├── {1103,1109}/{lflist.conf, script/*.lua}
 *           └── goat/{README.md, script/.gitkeep}（可选占位，不参与资源锁）
 *
 * 启用赛制的 script 目录只允许 .lua 文件与 .gitkeep，不允许子目录；
 * 其余越界条目（包括未启用赛制的卡表和脚本）都拒绝。
 */
export async function checkNostalgiaResourceBoundaries(
	resourceRoot: string,
	profile: NostalgiaResourceProfile = "2011",
): Promise<void> {
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
	const formatEntries = await expectEntries(
		formatsDir,
		new Map([
			["1103", "dir"],
			["1109", "dir"],
			["goat", "dir"],
		]),
		"formats",
	);
	if (profile === "goat") {
		const goatDir = path.join(formatsDir, "goat");
		await expectEntries(
			goatDir,
			new Map([
				["README.md", "file"],
				["lflist.conf", "file"],
				["cards.cdb", "file"],
				["lock.json", "file"],
				["script", "dir"],
			]),
			"GOAT resource",
		);
		await expectScriptDirectory(path.join(goatDir, "script"));
	} else if (formatEntries.some((entry) => entry.name === "goat")) {
		const goatDir = path.join(formatsDir, "goat");
		await expectEntries(
			goatDir,
			new Map([
				["README.md", "file"],
				["script", "dir"],
			]),
			"GOAT placeholder",
		);
		await expectEntries(
			path.join(goatDir, "script"),
			new Map([[".gitkeep", "file"]]),
			"GOAT script placeholder",
		);
	}

	for (const formatId of getActiveNostalgiaFormatIds(profile)) {
		if (formatId === "goat") continue;
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
) {
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === ".DS_Store" && entry.isFile()) continue;
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
	return entries;
}

async function expectScriptDirectory(scriptDirectory: string): Promise<void> {
	for (const entry of await readdir(scriptDirectory, { withFileTypes: true })) {
		if (entry.name === ".DS_Store" && entry.isFile()) continue;
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

async function buildNostalgiaResourceLock(
	resourceRoot: string,
	profile: NostalgiaResourceProfile,
): Promise<NostalgiaResourceLock> {
	const baseDatabasePath = path.join(
		resolveBaseDatabaseDirectory(resourceRoot, profile),
		"cards.cdb",
	);
	const baseCardIds = new Set(await readCdbCardIds(baseDatabasePath));
	const baseTokenIds = new Set(await readCdbTokenIds(baseDatabasePath));
	const baseScriptDirectory = path.join(resourceRoot, "ygopro", "base", "script");
	const baseScriptSelection = await summarizeBaseScriptSelection(baseScriptDirectory, baseCardIds);

	const activeFormats = getActiveNostalgiaFormatIds(profile);
	const formatScriptDirectories = activeFormats.map((id) =>
		path.join(resourceRoot, "ygopro", "formats", id, "script"),
	);
	const scriptTokenIds = await scanTokenCodes(formatScriptDirectories);
	const validateBaseTokens = async (goatCardIds?: Set<number>) => {
		const baseTokens = await scanTokenCodes([baseScriptDirectory], (filename) => {
			const cardId = /^c(\d+)\.lua$/.exec(path.basename(filename))?.[1];
			return !goatCardIds || !cardId || goatCardIds.has(Number(cardId));
		});
		const referencedTokens = new Set([...scriptTokenIds, ...baseTokens]);
		const missingTokens = [...referencedTokens].filter((cardId) => !baseTokenIds.has(cardId));
		if (missingTokens.length > 0) {
			throw new Error(
				`script token references missing from base CDB: ${missingTokens.sort((a, b) => a - b).join(", ")}`,
			);
		}
		if (profile === "2011") {
			const extraTokens = [...baseTokenIds].filter((cardId) => !referencedTokens.has(cardId));
			if (extraTokens.length > 0) {
				throw new Error(
					`base CDB token cards not referenced by scripts: ${extraTokens.sort((a, b) => a - b).join(", ")}`,
				);
			}
		}
	};
	if (profile === "2011") await validateBaseTokens();

	const formats = Object.fromEntries(
		await Promise.all(
			activeFormats.map(async (formatId) => {
				const lflistPath = path.join(resourceRoot, "ygopro", "formats", formatId, "lflist.conf");
				const sourceText = await readFile(lflistPath, "utf-8");
				const text =
					formatId === "goat"
						? prepareGoatLfList(sourceText, baseDatabasePath, baseCardIds, baseTokenIds)
						: sourceText;
				const validated = validateFormatWhitelist(text, baseCardIds);
				if (formatId === "goat") {
					validateGoatWhitelist(validated, baseTokenIds);
					await validateBaseTokens(validated.cardIds);
				}
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
							sha256: sha256Text(sourceText),
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

export async function readGoatLfList(resourceRoot: string, lflistPath: string): Promise<string> {
	const sourceText = await readFile(lflistPath, "utf-8");
	const cdbPath = path.join(resolveBaseDatabaseDirectory(resourceRoot, "goat"), "cards.cdb");
	return prepareGoatLfList(
		sourceText,
		cdbPath,
		new Set(await readCdbCardIds(cdbPath)),
		new Set(await readCdbTokenIds(cdbPath)),
	);
}

function prepareGoatLfList(
	sourceText: string,
	cdbPath: string,
	cardIds: Set<number>,
	tokenIds: Set<number>,
): string {
	const sections = sourceText.split(/^[ \t]*(?=!)/m);
	const selected = sections.filter((section) =>
		GOAT_LIST_HEADER.test(section.split(/\r?\n/, 1)[0].trim()),
	);
	if (selected.length !== 1) {
		throw new Error("GOAT requires exactly one 2005.4.1 W/O Exarion section");
	}
	const [text] = selected;
	if (text.split(/\r?\n/).some((line) => line.trim() === "$whitelist")) {
		return text;
	}
	if (path.basename(path.dirname(cdbPath)) !== "goat") {
		throw new Error(
			"GOAT needs a curated formats/goat/cards.cdb or a complete $whitelist in its LFList",
		);
	}

	const restrictions = parseWhitelist("$whitelist\n" + text).quantities;
	for (const [cardId, quantity] of restrictions) {
		if (quantity > 0 && !cardIds.has(cardId)) {
			throw new Error(`GOAT limited card missing from its CDB: ${cardId}`);
		}
	}
	restrictions.set(EXARION_UNIVERSE, 0);
	return [
		"!2005.4.1 W/O Exarion",
		"$whitelist",
		...[...cardIds]
			.filter((cardId) => !tokenIds.has(cardId))
			.map((cardId) => `${cardId} ${restrictions.get(cardId) ?? 3}`),
		"",
	].join("\n");
}

function validateGoatWhitelist(whitelist: ValidatedWhitelist, tokenIds: Set<number>): void {
	if ((whitelist.quantities.get(EXARION_UNIVERSE) ?? 0) > 0) {
		throw new Error("Exarion Universe is forbidden in this GOAT format");
	}
	if (![...whitelist.quantities.values()].some((quantity) => quantity > 0)) {
		throw new Error("GOAT whitelist has no playable cards");
	}
	for (const cardId of whitelist.cardIds) {
		if (tokenIds.has(cardId)) throw new Error(`GOAT whitelist contains token card: ${cardId}`);
	}
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

function sha256Text(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

async function hashFile(filePath: string): Promise<string> {
	return createHash("sha256")
		.update(await readFile(filePath))
		.digest("hex");
}

function relativePath(root: string, target: string): string {
	return path.relative(root, target).split(path.sep).join("/");
}
