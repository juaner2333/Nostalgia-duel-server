import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const RESOURCE_ROOT =
	process.env.RESOURCES_DIR ??
	fileURLToPath(new URL("../../nostalgia-resources/", import.meta.url));

/**
 * 从格式 whitelist 中选取 40 张无限制（qty=3）、有 base 脚本、类型为主卡组
 * 怪兽（非融合/同调/XYZ/连接）的真实卡片，保证通过真实卡组校验链。
 */
export async function buildDeck(formatId) {
	const formatDir = path.join(RESOURCE_ROOT, "ygopro", "formats", formatId);
	const lflistPath = path.join(formatDir, "lflist.conf");
	const lflist =
		formatId === "goat"
			? await import("../../dist/src/ygopro/ygopro/NostalgiaResourceGenerator.js").then(
					({ readGoatLfList }) => readGoatLfList(RESOURCE_ROOT, lflistPath),
				)
			: readFileSync(lflistPath, "utf-8");
	const scriptDir = path.join(RESOURCE_ROOT, "ygopro", "base", "script");
	const SQL = await initSqlJs();
	const goatCdb = path.join(formatDir, "cards.cdb");
	const cdbPath =
		formatId === "goat" && existsSync(goatCdb)
			? goatCdb
			: path.join(RESOURCE_ROOT, "ygopro", "base", "cards.cdb");
	const database = new SQL.Database(readFileSync(cdbPath));
	const result = database.exec("SELECT id, type, ot FROM datas")[0];
	database.close();
	const allowedScope = formatId === "goat" ? 2 : 1;
	const types = new Map(
		result.values
			.filter(([, , ot]) => (Number(ot) & allowedScope) !== 0)
			.map(([id, type]) => [Number(id), Number(type)]),
	);
	const EXTRA_TYPES = 0x40 | 0x2000 | 0x800000 | 0x4000000; // 融合 | 同调 | XYZ | 连接

	const codes = [];
	for (const rawLine of lflist.split(/\r?\n/)) {
		const match = /^(\d+)\s+3(?:\s|$)/.exec(rawLine.trim());
		if (!match) {
			continue;
		}
		const code = Number(match[1]);
		const type = types.get(code) ?? 0;
		if (
			type & 0x1 &&
			!(type & EXTRA_TYPES) &&
			(existsSync(path.join(scriptDir, `c${code}.lua`)) ||
				existsSync(path.join(formatDir, "script", `c${code}.lua`)))
		) {
			codes.push(code);
			if (codes.length === 40) {
				break;
			}
		}
	}
	if (codes.length < 40) {
		throw new Error(`format ${formatId}: only ${codes.length} main-deck monsters found`);
	}
	return codes;
}
