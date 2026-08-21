import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";
import { YGOProLFListItem } from "ygopro-lflist-encode";

const MIN_CARD_ID = 1;
const MAX_CARD_ID = 0x7fffffff;
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
	let actual: string;
	try {
		actual = await readFile(lockPath, "utf-8");
	} catch (error) {
		throw new Error(`resource lock missing: ${lockPath}: ${String(error)}`);
	}
	const expected = `${JSON.stringify(await buildNostalgiaResourceLock(resourceRoot), null, "\t")}\n`;
	if (actual !== expected) {
		throw new Error(`resource lock drift: ${lockPath}`);
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
	const baseScriptDirectory = path.join(resourceRoot, "ygopro", "base", "script");
	const baseScriptSelection = await summarizeBaseScriptSelection(baseScriptDirectory, baseCardIds);

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
