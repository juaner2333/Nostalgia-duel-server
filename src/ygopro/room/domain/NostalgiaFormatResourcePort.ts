import type { NostalgiaFormatId } from "./NostalgiaFormat";

/** Resource boundary for a room's immutable format metadata. */
export interface NostalgiaFormatResourcePort {
	getBanListHash(formatId: NostalgiaFormatId): number | null;
}
