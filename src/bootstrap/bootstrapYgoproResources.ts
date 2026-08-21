import path from "node:path";
import { Logger } from "@shared/logger/domain/Logger";
import { YGOProResourceLoader } from "@ygopro/ygopro/YGOProResourceLoader";
import YGOProBanListMemoryRepository from "@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository";
import { checkNostalgiaResourceLock } from "@ygopro/ygopro/NostalgiaResourceGenerator";
import { config } from "src/config";
import { loadYgoproBanLists } from "./bootstrapBanListLoaders";

// Runs the full fixed-resource integrity check before any resource is loaded.
// The caller (src/index.ts) invokes this before persistence connections and
// port listeners, so a drifted or missing resource tree fails fast and the
// process never accepts traffic.
export async function checkYgoproResourceIntegrity(): Promise<void> {
	const lockPath = path.join(config.resources.dir, "lock.json");
	await checkNostalgiaResourceLock(config.resources.dir, lockPath);
}

// Loads ygopro card resources and ban lists.
export async function bootstrapYgoproResources(logger: Logger): Promise<void> {
	await checkYgoproResourceIntegrity();
	logger.info("🔒 Fixed nostalgia resources integrity verified");
	await YGOProResourceLoader.start();
	await YGOProResourceLoader.get().logLFLists();

	const tmp = await loadYgoproBanLists();
	YGOProBanListMemoryRepository.replaceAll(tmp);

	logger.info("🎴 YGOPro resources & ban lists loaded");
}
