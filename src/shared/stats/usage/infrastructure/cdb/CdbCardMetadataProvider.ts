import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { CardMetadata, CardMetadataProvider } from "../../domain/CardUsageCalculator";

export class CdbCardMetadataProvider implements CardMetadataProvider {
	private loadedPromise: Promise<void> | null = null;
	private readonly cards = new Map<number, CardMetadata>();
	private readonly aliasMap = new Map<number, number>();

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

	public async load(): Promise<this> {
		if (!this.loadedPromise) {
			this.loadedPromise = (async () => {
				const filePath = this.resolveCdbPath();
				if (!fsSync.existsSync(filePath)) {
					throw new Error(`Fixed cards.cdb not found at resolved path: ${filePath}`);
				}
				const body = await fs.readFile(filePath);
				const SQL = await initSqlJs();
				const db = new SQL.Database(body);
				try {
					const results = db.exec(`
						SELECT d.id, d.alias, d.type, t.name
						FROM datas d
						LEFT JOIN texts t ON d.id = t.id
					`);
					if (results.length > 0) {
						for (const [id, alias, type, name] of results[0].values) {
							if (typeof id === "number") {
								const numAlias = typeof alias === "number" ? alias : 0;
								const numType = typeof type === "number" ? type : 0;
								const strName = typeof name === "string" ? name : "";
								this.cards.set(id, {
									id,
									alias: numAlias,
									type: numType,
									name: strName,
								});
								if (numAlias !== 0 && numAlias !== id) {
									this.aliasMap.set(id, numAlias);
								}
							}
						}
					}
				} finally {
					db.close();
				}
				if (this.cards.size === 0) {
					throw new Error(`Fixed cards.cdb at ${filePath} contains 0 cards.`);
				}
			})();
		}
		await this.loadedPromise;
		return this;
	}

	public getCardMetadata(cardId: number): CardMetadata | undefined {
		return this.cards.get(cardId);
	}

	public getCanonicalCardId(cardId: number): number {
		let current = cardId;
		let depth = 0;
		while (depth < 10) {
			const target = this.aliasMap.get(current);
			if (target === undefined || target === 0 || target === current) {
				break;
			}
			current = target;
			depth++;
		}
		return current;
	}

	public hasCard(cardId: number): boolean {
		return this.cards.has(cardId);
	}
}
