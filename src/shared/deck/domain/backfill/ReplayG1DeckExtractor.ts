import { YGOProYrp } from "ygopro-yrp-encode";

export interface ExtractedPlayerDeck {
	mainCards: number[];
	extraCards: number[];
	sideCards: null;
}

export interface ExtractedG1ReplayDecks {
	hostName: string;
	clientName: string;
	hostDeck: ExtractedPlayerDeck;
	clientDeck: ExtractedPlayerDeck;
}

export class ReplayG1DeckExtractor {
	extractFromYrp(yrpBytes: Uint8Array | Buffer): ExtractedG1ReplayDecks | null {
		if (!yrpBytes || yrpBytes.length < 32) {
			return null;
		}

		try {
			const yrp = new YGOProYrp().fromYrp(yrpBytes);
			if (!yrp.header) {
				return null;
			}

			// Must not be tag duel
			if (yrp.isTag) {
				return null;
			}

			const hostName = yrp.hostName?.trim();
			const clientName = yrp.clientName?.trim();
			if (!hostName || !clientName) {
				return null;
			}

			if (!yrp.hostDeck || !yrp.clientDeck) {
				return null;
			}

			const hostMain = yrp.hostDeck.main ?? [];
			const hostExtra = yrp.hostDeck.extra ?? [];
			const clientMain = yrp.clientDeck.main ?? [];
			const clientExtra = yrp.clientDeck.extra ?? [];

			// Validate main deck size: 40 - 60
			if (hostMain.length < 40 || hostMain.length > 60) {
				return null;
			}
			if (clientMain.length < 40 || clientMain.length > 60) {
				return null;
			}

			// Validate extra deck size: 0 - 15
			if (hostExtra.length > 15) {
				return null;
			}
			if (clientExtra.length > 15) {
				return null;
			}

			return {
				hostName,
				clientName,
				hostDeck: {
					mainCards: [...hostMain],
					extraCards: [...hostExtra],
					sideCards: null,
				},
				clientDeck: {
					mainCards: [...clientMain],
					extraCards: [...clientExtra],
					sideCards: null,
				},
			};
		} catch {
			return null;
		}
	}
}
