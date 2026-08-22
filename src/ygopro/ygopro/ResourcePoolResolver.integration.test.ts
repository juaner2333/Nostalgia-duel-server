import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { YGOProCdb } from "ygopro-cdb-encode";
import LoggerFactory from "src/shared/logger/infrastructure/LoggerFactory";
import { CardStorage } from "./card-storage";
import { resolvePools } from "./ResourcePoolResolver";
import { readWhitelistCardIds } from "./YGOProResourceLoader";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const RESOURCE_ROOT = path.join(PROJECT_ROOT, "nostalgia-resources");

function sorted(cardIds: Iterable<number>): number[] {
	return [...cardIds].sort((left, right) => left - right);
}

function findCdbFiles(directory: string): string[] {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			return findCdbFiles(entryPath);
		}
		return entry.name.endsWith(".cdb") ? [entryPath] : [];
	});
}

describe("fixed nostalgia resource integration", () => {
	it("loads only the fixed base CDB and derives the two exact format card pools", async () => {
		const pools = resolvePools({
			resourcesDir: RESOURCE_ROOT,
			logger: LoggerFactory.getLogger(),
		});
		const basePath = pools.base;

		expect(basePath).toBe(path.join(RESOURCE_ROOT, "ygopro", "base"));
		expect(findCdbFiles(path.join(RESOURCE_ROOT, "ygopro"))).toEqual([
			path.join(RESOURCE_ROOT, "ygopro", "base", "cards.cdb"),
		]);

		const SQL = await initSqlJs();
		const cdb = new YGOProCdb(
			new SQL.Database(fs.readFileSync(path.join(basePath!, "cards.cdb"))),
		).noTexts();
		const baseCards = [...cdb.step()];
		cdb.finalize();
		const baseCardIds = new Set(baseCards.map((card) => card.code));
		const tokenCardIds = new Set(
			baseCards.filter((card) => (card.type ?? 0) & 0x4000).map((card) => card.code),
		);
		const baseStorage = CardStorage.fromCards(baseCards);
		const pool1103 = await readWhitelistCardIds(path.join(pools.formats["1103"], "lflist.conf"));
		const pool1109 = await readWhitelistCardIds(path.join(pools.formats["1109"], "lflist.conf"));
		const storage1103 = baseStorage.filterForFormat(pool1103);
		const storage1109 = baseStorage.filterForFormat(pool1109);

		expect(baseStorage.size).toBe(5199);
		expect(storage1103.size).toBe(5002 + tokenCardIds.size);
		expect(storage1109.size).toBe(5120 + tokenCardIds.size);
		expect(sorted(pool1103)).toEqual(
			sorted([...baseCardIds].filter((cardId) => pool1103.has(cardId))),
		);
		// 基础数据库 = 1109 实卡池 ∪ 脚本引用的 token 虚拟卡；token 不属于任何环境卡池。
		expect(sorted([...tokenCardIds].filter((cardId) => pool1109.has(cardId)))).toEqual([]);
		expect(sorted(pool1109)).toEqual(
			sorted([...baseCardIds].filter((cardId) => !tokenCardIds.has(cardId))),
		);
		for (const cardId of pool1103) {
			expect(storage1103.readCard(cardId)).toBeDefined();
		}
		for (const cardId of pool1109) {
			expect(storage1109.readCard(cardId)).toBeDefined();
		}
		// 引擎视图保留全部 token 元数据，保证 Duel.CreateToken 可读取。
		for (const cardId of tokenCardIds) {
			expect(storage1103.readCard(cardId)).toBeDefined();
			expect(storage1109.readCard(cardId)).toBeDefined();
		}
	});
});
