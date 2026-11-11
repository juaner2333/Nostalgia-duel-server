import { HostInfo } from "ygopro-msg-encode";
import { OcgcoreDuelOptionFlag } from "koishipro-core.js";
import type { NostalgiaFormatId } from "../room/domain/NostalgiaFormat";

// Keep these bits in sync with common.h in vendor/goat-core/rulings.patch.
const OLD_ATTACK_REPLAY = 0x04;
const DESTROY_ZERO_ATK_TIE = 0x200;

/**
 * Calculate duel options from HostInfo
 * @param hostinfo HostInfo from ygopro-msg-encode
 * @param formatId Room format, if available
 * @returns Duel options number
 */
export function calculateDuelOptions(hostinfo: HostInfo, formatId?: NostalgiaFormatId): number {
	// duel_rule is stored in high 16 bits
	let opt = hostinfo.duel_rule << 16;

	if (hostinfo.no_shuffle_deck) {
		opt |= OcgcoreDuelOptionFlag.PseudoShuffle;
	}

	if (hostinfo.mode & 0x2) {
		opt |= OcgcoreDuelOptionFlag.TagMode;
	}

	if (formatId === "goat") {
		opt |= OLD_ATTACK_REPLAY | DESTROY_ZERO_ATK_TIE;
	}

	return opt;
}
