import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Request, Response } from "express";

import YGOProBanListMemoryRepository from "@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository";
import { YGOProResourceLoader } from "@ygopro/ygopro/YGOProResourceLoader";
import { BanList } from "src/shared/ban-list/BanList";
import { config } from "src/config";

// Reports the versions/hashes of the resources this server has actually loaded, so a
// client can compare them against what it downloaded and detect drift. Every field is
// nullable: a freshly booted server may not have computed a given hash yet, and the
// endpoint must still answer 200 rather than fail.
export class GetResourceVersionController {
	run(_req: Request, response: Response): void {
		// get() would lazily construct a loader (with filesystem + timer side effects),
		// so only read it once something has actually initialized it.
		const loader = YGOProResourceLoader.isInitialized ? YGOProResourceLoader.get() : null;

		response.status(200).json({
			schemaVersion: 1,
			fixedNostalgia: readFixedNostalgiaVersion(),
			ygopro: {
				baseSha512: loader?.baseSha512Hex ?? null,
			},
			banlists: {
				ygopro: toBanListVersions(YGOProBanListMemoryRepository.get()),
			},
		});
	}
}

interface FixedNostalgiaVersion {
	schemaVersion: number;
	lock: { sha256: string };
	baseDatabase: { count: number; cardIdsSha256: string };
	formats: Record<
		string,
		{ cardPool: { count: number; cardIdsSha256: string }; lflist: { hash: number; sha256: string } }
	>;
}

function readFixedNostalgiaVersion(): FixedNostalgiaVersion | null {
	try {
		const lockText = fs.readFileSync(path.join(config.resources.dir, "lock.json"), "utf-8");
		const lock = JSON.parse(lockText) as unknown;
		const root = asRecord(lock);
		const inputs = asRecord(root?.inputs);
		const baseDatabase = asRecord(inputs?.baseDatabase);
		const formats = asRecord(root?.formats);
		const formatVersions = Object.fromEntries(
			["1103", "1109"].map((formatId) => {
				const format = asRecord(formats?.[formatId]);
				const cardPool = asRecord(format?.cardPool);
				const lflist = asRecord(format?.lflist);
				if (
					typeof cardPool?.count !== "number" ||
					typeof cardPool.cardIdsSha256 !== "string" ||
					typeof lflist?.hash !== "number" ||
					typeof lflist.sha256 !== "string"
				) {
					throw new Error(`Invalid ${formatId} resource summary`);
				}
				return [formatId, { cardPool, lflist }];
			}),
		);
		if (
			typeof root?.schemaVersion !== "number" ||
			typeof baseDatabase?.count !== "number" ||
			typeof baseDatabase.cardIdsSha256 !== "string"
		) {
			return null;
		}

		return {
			schemaVersion: root.schemaVersion,
			lock: { sha256: createHash("sha256").update(lockText).digest("hex") },
			baseDatabase: {
				count: baseDatabase.count,
				cardIdsSha256: baseDatabase.cardIdsSha256,
			},
			formats: formatVersions as FixedNostalgiaVersion["formats"],
		};
	} catch {
		return null;
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function toBanListVersions(banLists: BanList[]): Array<{ name: string; hash: number }> {
	return banLists
		.filter((banList) => banList.name !== null)
		.map((banList) => ({ name: banList.name as string, hash: banList.hash }));
}
