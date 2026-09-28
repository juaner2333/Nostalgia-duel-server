import { YGOProYrp } from "ygopro-yrp-encode";

export interface ExtractedDuelSeat {
	hostName: string;
	clientName: string;
}

export interface ResolvedPlayerSeats {
	player1IsFirst: boolean;
	player2IsFirst: boolean;
}

export class ReplayDuelSeatExtractor {
	extractFromYrp(yrpBytes: Uint8Array | Buffer): ExtractedDuelSeat | null {
		if (!yrpBytes || yrpBytes.length < 32) {
			return null;
		}

		try {
			const yrp = new YGOProYrp().fromYrp(yrpBytes);
			if (!yrp.header) {
				return null;
			}

			// 1v1 match only; tag duel not supported
			if (yrp.isTag) {
				return null;
			}

			const hostName = yrp.hostName?.trim();
			const clientName = yrp.clientName?.trim();
			if (!hostName || !clientName) {
				return null;
			}

			// Ambiguous identity if both players have identical names
			if (hostName === clientName) {
				return null;
			}

			return {
				hostName,
				clientName,
			};
		} catch {
			return null;
		}
	}

	resolvePlayerSeats(
		extracted: ExtractedDuelSeat,
		player1Name: string,
		player2Name: string,
	): ResolvedPlayerSeats | null {
		const p1 = player1Name.trim();
		const p2 = player2Name.trim();

		// Match-level ambiguous identity
		if (p1 === p2) {
			return null;
		}

		if (extracted.hostName === p1 && extracted.clientName === p2) {
			return {
				player1IsFirst: true,
				player2IsFirst: false,
			};
		}

		if (extracted.hostName === p2 && extracted.clientName === p1) {
			return {
				player1IsFirst: false,
				player2IsFirst: true,
			};
		}

		return null;
	}
}
