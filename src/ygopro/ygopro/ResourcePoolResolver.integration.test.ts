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
		const baseStorage = CardStorage.fromCards(baseCards);
		const pool1103 = await readWhitelistCardIds(path.join(pools.formats["1103"], "lflist.conf"));
		const pool1109 = await readWhitelistCardIds(path.join(pools.formats["1109"], "lflist.conf"));
		const storage1103 = baseStorage.filterByCardIds(pool1103);
		const storage1109 = baseStorage.filterByCardIds(pool1109);

		expect(baseStorage.size).toBe(5120);
		expect(storage1103.size).toBe(5002);
		expect(storage1109.size).toBe(5120);
		expect(sorted(pool1103)).toEqual(
			sorted([...baseCardIds].filter((cardId) => pool1103.has(cardId))),
		);
		expect(sorted(pool1109)).toEqual(sorted(baseCardIds));
		for (const cardId of pool1103) {
			expect(storage1103.readCard(cardId)).toBeDefined();
		}
		for (const cardId of pool1109) {
			expect(storage1109.readCard(cardId)).toBeDefined();
		}
	});
});
