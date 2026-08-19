import { Logger } from "@shared/logger/domain/Logger";
import { YGOProResourceLoader } from "@ygopro/ygopro/YGOProResourceLoader";
import YGOProBanListMemoryRepository from "@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository";
import { loadYgoproBanLists } from "./bootstrapBanListLoaders";

// Loads ygopro card resources and ban lists.
export async function bootstrapYgoproResources(logger: Logger): Promise<void> {
	await YGOProResourceLoader.start();
	await YGOProResourceLoader.get().logLFLists();

	const tmp = await loadYgoproBanLists();
	YGOProBanListMemoryRepository.replaceAll(tmp);

	logger.info("🎴 YGOPro resources & ban lists loaded");
}
