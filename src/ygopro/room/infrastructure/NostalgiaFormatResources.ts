import YGOProBanListMemoryRepository from "@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository";
import { getNostalgiaFormat, type NostalgiaFormatId } from "../domain/NostalgiaFormat";
import type { NostalgiaFormatResourcePort } from "../domain/NostalgiaFormatResourcePort";

export class NostalgiaFormatResources implements NostalgiaFormatResourcePort {
	getBanListHash(formatId: NostalgiaFormatId): number | null {
		const format = getNostalgiaFormat(formatId);
		return format
			? (YGOProBanListMemoryRepository.findByName(format.banListName)?.hash ?? null)
			: null;
	}
}
