import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { CardAliasProvider } from "@shared/stats/persistence/RankedMatchPersistenceService";

export class CdbCardAliasProvider implements CardAliasProvider {
	private aliasPromise: Promise<ReadonlyMap<number, number>> | null = null;

	constructor(private readonly cdbPath?: string) {}

	private resolveCdbPath(): string {
		if (this.cdbPath) {
			return this.cdbPath;
		}
		const resourcesDir = process.env.RESOURCES_DIR || "./nostalgia-resources";
		const primaryPath = path.resolve(process.cwd(), resourcesDir, "ygopro", "base", "cards.cdb");
		if (fsSync.existsSync(primaryPath)) {
			return primaryPath;
		}
		const fallbackPath = path.resolve(
			__dirname,
			"../../../../../../nostalgia-resources/ygopro/base/cards.cdb",
		);
		if (fsSync.existsSync(fallbackPath)) {
			return fallbackPath;
		}
		return primaryPath;
	}

	async getAliases(_formatId: string): Promise<ReadonlyMap<number, number>> {
		if (!this.aliasPromise) {
			this.aliasPromise = (async () => {
				const filePath = this.resolveCdbPath();
				if (!fsSync.existsSync(filePath)) {
					return new Map<number, number>();
				}
				const body = await fs.readFile(filePath);
				const SQL = await initSqlJs();
				const db = new SQL.Database(body);
				const aliases = new Map<number, number>();
				try {
					const results = db.exec("SELECT id, alias FROM datas WHERE alias != 0 AND alias != id");
					if (results.length > 0) {
						for (const [id, alias] of results[0].values) {
							if (typeof id === "number" && typeof alias === "number") {
								aliases.set(id, alias);
							}
						}
					}
				} finally {
					db.close();
				}
				return aliases;
			})();
		}
		return this.aliasPromise;
	}
}
