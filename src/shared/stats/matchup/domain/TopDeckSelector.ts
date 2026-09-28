export interface DeckUsageCount {
	deckTypeCode: string;
	deckCount: number;
}

export class TopDeckSelector {
	public static readonly MAX_TOP_DECKS = 15;
	public static readonly EXCLUDED_CODES = new Set(["OTHERS"]);

	public static selectTopDecks(
		formatId: string,
		deckCounts: ReadonlyMap<string, number> | readonly DeckUsageCount[],
	): string[] {
		if (formatId !== "1109") {
			return [];
		}

		const entries: DeckUsageCount[] = [];
		if (Array.isArray(deckCounts)) {
			entries.push(...(deckCounts as readonly DeckUsageCount[]));
		} else {
			const map = deckCounts as ReadonlyMap<string, number>;
			map.forEach((count, code) => {
				entries.push({ deckTypeCode: code, deckCount: count });
			});
		}

		return entries
			.filter((e) => !this.EXCLUDED_CODES.has(e.deckTypeCode) && e.deckCount > 0)
			.sort((a, b) => {
				if (b.deckCount !== a.deckCount) {
					return b.deckCount - a.deckCount;
				}
				return a.deckTypeCode.localeCompare(b.deckTypeCode);
			})
			.slice(0, this.MAX_TOP_DECKS)
			.map((e) => e.deckTypeCode);
	}
}
