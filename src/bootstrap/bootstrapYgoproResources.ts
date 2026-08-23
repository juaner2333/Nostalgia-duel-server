import path from "node:path";
import { Logger } from "@shared/logger/domain/Logger";
import { NOSTALGIA_FORMAT_IDS } from "@ygopro/room/domain/NostalgiaFormat";
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

	// Pre-warm both enabled formats and the shared ocgcore WASM module so the
	// first real duel starts at steady-state speed (no cold compile or card
	// pool load). Any pre-warm failure fails the startup before any listener
	// opens (fail-fast, same philosophy as the resource lock check).
	const loader = YGOProResourceLoader.getShared();
	await Promise.all([
		...NOSTALGIA_FORMAT_IDS.map((formatId) => loader.getFormatCardStorage(formatId)),
		loader.getOcgcoreWasmModule(),
	]);
	logger.info("🔥 Pre-warmed 1103/1109 card storages and precompiled ocgcore WASM module");

	const tmp = await loadYgoproBanLists();
	YGOProBanListMemoryRepository.replaceAll(tmp);

	logger.info("🎴 YGOPro resources & ban lists loaded");
}
