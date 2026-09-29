import { TopDeckSelector } from "./TopDeckSelector";

describe("TopDeckSelector (Task 4.1)", () => {
	it("returns empty array for non-1109 formats such as 1103", () => {
		const deckCounts = new Map<string, number>([
			["HERO_BEAT", 100],
			["SIX_SAMURAI", 90],
		]);
		expect(TopDeckSelector.selectTopDecks("1103", deckCounts)).toEqual([]);
	});

	it("sorts by count DESC, tie-breaks by deckTypeCode ASC, and limits to 16", () => {
		const deckCounts = new Map<string, number>([
			["DECK_B", 50],
			["DECK_A", 50], // Same count as DECK_B, but DECK_A comes first alphabetically
			["DECK_C", 60], // Highest count
			["DECK_D", 40],
			["DECK_E", 30],
			["DECK_F", 20],
			["DECK_G", 15],
			["DECK_H", 14],
			["DECK_I", 13],
			["DECK_J", 12],
			["DECK_K", 11],
			["DECK_L", 10],
			["DECK_M", 9],
			["DECK_N", 8],
			["DECK_O", 7],
			["DECK_P", 6], // 16th
			["DECK_Q", 5], // 17th (excluded)
		]);

		const top16 = TopDeckSelector.selectTopDecks("1109", deckCounts);

		expect(top16).toHaveLength(16);
		expect(top16[0]).toBe("DECK_C"); // 60
		expect(top16[1]).toBe("DECK_A"); // 50 (tie-break over B)
		expect(top16[2]).toBe("DECK_B"); // 50
		expect(top16[15]).toBe("DECK_P"); // 16th
		expect(top16).not.toContain("DECK_Q");
	});

	it("tie-breaks on the 16th boundary and excludes the 17th", () => {
		// 15 top decks with count 20
		const deckCounts = new Map<string, number>();
		for (let i = 1; i <= 15; i++) {
			deckCounts.set(`TOP_${String(i).padStart(2, "0")}`, 20);
		}
		// 16th and 17th share count 10, but Z_TIE vs A_TIE
		deckCounts.set("Z_TIE", 10);
		deckCounts.set("A_TIE", 10);

		const top16 = TopDeckSelector.selectTopDecks("1109", deckCounts);
		expect(top16).toHaveLength(16);
		expect(top16[15]).toBe("A_TIE"); // A_TIE comes before Z_TIE
		expect(top16).not.toContain("Z_TIE");
	});

	it("strictly excludes OTHERS even when OTHERS has the highest usage", () => {
		const deckCounts = new Map<string, number>([
			["OTHERS", 1000], // Huge count
			["DARK_WORLD", 80],
			["RABBIT", 75],
		]);

		const top = TopDeckSelector.selectTopDecks("1109", deckCounts);
		expect(top).toEqual(["DARK_WORLD", "RABBIT"]);
		expect(top).not.toContain("OTHERS");
	});

	it("handles fewer than 16 categories by returning all eligible categories", () => {
		const deckCounts = new Map<string, number>([
			["HERO_BEAT", 100],
			["SIX_SAMURAI", 90],
			["AGENT_ANGEL", 80],
			["ZERO_COUNT_DECK", 0], // Excluded
		]);

		const top = TopDeckSelector.selectTopDecks("1109", deckCounts);
		expect(top).toEqual(["HERO_BEAT", "SIX_SAMURAI", "AGENT_ANGEL"]);
	});
});
