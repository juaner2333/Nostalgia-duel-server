import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 从 1103/1109 固定 Lua 脚本中提取引擎会要求 CDB 提供卡数据的 token 代码。
 *
 * ocgcore 的 `Duel.CreateToken` 与
 * `Duel.IsPlayerCanSpecialSummonMonster(..., TYPES_TOKEN_MONSTER, ...)`
 * 都会按代码读取卡阅读器（固定 CDB）；卡数据缺失时 token 无法生成。
 * 该扫描器收集全部静态引用（含 `for i=start,finish` 循环展开），
 * 供资源锁校验断言“脚本引用的 token 必须存在于基础 CDB”。
 */

const CREATE_TOKEN_REFERENCE = /Duel\.CreateToken\(\s*(?:tp|1-tp)\s*,\s*(\d+)(?:\s*\+\s*i)?\s*\)/g;
const TOKEN_LOOP = /for\s+i\s*=\s*(\d+)\s*,\s*(\d+)\s*do/g;
const TOKEN_SUMMON_MONSTER_REFERENCE =
	/Duel\.IsPlayerCanSpecialSummonMonster\(\s*(?:tp|1-tp)\s*,\s*(\d+)[\s\S]*?TYPES_TOKEN_MONSTER/g;

/** 单个脚本中的 token 代码（含循环展开） */
export function extractTokenCodes(luaText: string): Set<number> {
	const codes = new Set<number>();

	const loopStarts: Array<{ first: number; last: number; begin: number; finish: number }> = [];
	for (const match of luaText.matchAll(TOKEN_LOOP)) {
		loopStarts.push({
			first: Number(match[1]),
			last: Number(match[2]),
			begin: match.index ?? 0,
			finish: (match.index ?? 0) + match[0].length,
		});
	}

	for (const match of luaText.matchAll(CREATE_TOKEN_REFERENCE)) {
		const base = Number(match[1]);
		const isLoop = match[0].match(/\+\s*i/) !== null;
		if (!isLoop) {
			codes.add(base);
			continue;
		}
		const loop = [...loopStarts]
			.filter((candidate) => candidate.finish <= (match.index ?? 0))
			.sort((left, right) => right.begin - left.begin)[0];
		if (!loop) {
			continue;
		}
		for (let i = loop.first; i <= loop.last; i++) {
			codes.add(base + i);
		}
	}

	for (const match of luaText.matchAll(TOKEN_SUMMON_MONSTER_REFERENCE)) {
		codes.add(Number(match[1]));
	}

	return codes;
}

/** 递归扫描脚本目录（format-first 查找链的全部目录） */
export async function scanTokenCodes(scriptDirectories: string[]): Promise<Set<number>> {
	const codes = new Set<number>();
	async function walk(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				await walk(entryPath);
			} else if (entry.isFile() && entry.name.endsWith(".lua")) {
				for (const code of extractTokenCodes(await readFile(entryPath, "utf-8"))) {
					codes.add(code);
				}
			}
		}
	}
	for (const directory of scriptDirectories) {
		await walk(directory);
	}
	return codes;
}
