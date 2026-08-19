// Re-callable pure builder for ygopro ban lists.
//
// This function parses ban lists into a local temporary array and does NOT touch
// the live YGOProBanListMemoryRepository. The caller (bootstrapBanListReloader)
// is responsible for atomically swapping the repo via replaceAll() once the
// array is successfully built.

import { YGOProBanListLoader } from "@ygopro/ban-list/infrastructure/YGOProBanListLoader";
import { YGOProBanList } from "@ygopro/ban-list/domain/YGOProBanList";

/**
 * Loads ygopro ban lists into a fresh temporary array.
 * Does NOT write to YGOProBanListMemoryRepository.
 * Throws on parse error — callers are responsible for error handling.
 */
export async function loadYgoproBanLists(): Promise<YGOProBanList[]> {
	const tmp: YGOProBanList[] = [];
	const loader = new YGOProBanListLoader(tmp);
	await loader.load();
	return loader.getLoaded();
}
