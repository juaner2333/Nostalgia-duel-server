import { CardMetadataProvider, CardUsageCalculator } from "./CardUsageCalculator";
import { PlayerMatchDeckSnapshot } from "./DeckUsageCalculator";
import { CardTypes } from "@shared/card/domain/CardTypes";

describe("CardUsageCalculator", () => {
	// Mock CardMetadataProvider
	const mockMetadataProvider: CardMetadataProvider = {
		getCardMetadata: (id: number) => {
			if (id === 101 || id === 102) {
				// 102 is alt-art of 101 (Monster)
				return { id, alias: id === 102 ? 101 : 0, type: CardTypes.TYPE_MONSTER, name: "Monster 1" };
			}
			if (id === 201) {
				// Spell
				return { id, alias: 0, type: CardTypes.TYPE_SPELL, name: "Spell 1" };
			}
			if (id === 301) {
				// Trap
				return { id, alias: 0, type: CardTypes.TYPE_TRAP, name: "Trap 1" };
			}
			if (id === 401) {
				// Extra monster (Synchro)
				return {
					id,
					alias: 0,
					type: CardTypes.TYPE_SYNCHRO | CardTypes.TYPE_MONSTER,
					name: "Synchro 1",
				};
			}
			if (id === 501) {
				// Multi-slot card (used in Main and Side)
				return { id, alias: 0, type: CardTypes.TYPE_SPELL, name: "MST" };
			}
			return undefined;
		},
		getCanonicalCardId: (id: number) => {
			if (id === 102) return 101;
			return id;
		},
	};

	it("classifies Main into monster, spell, trap and Extra into extra", () => {
		const calculator = new CardUsageCalculator(mockMetadataProvider, "1109", "2026-07-01");
		const snapshot: PlayerMatchDeckSnapshot = {
			matchId: "m1",
			formatId: "1109",
			deckTypeCode: "D01",
			mainCards: [101, 201, 201, 301, 301, 301],
			extraCards: [401],
			sideCards: [],
		};

		const result = calculator.calculate([snapshot]);

		// Monster: 1 copy of 101
		const mRow = result.find((r) => r.metric === "monster" && r.cardId === 101);
		expect(mRow).toBeDefined();
		expect(mRow?.deckCount).toBe(1);
		expect(mRow?.copies1).toBe(1);
		expect(mRow?.copies2).toBe(0);
		expect(mRow?.copies3).toBe(0);

		// Spell: 2 copies of 201
		const sRow = result.find((r) => r.metric === "spell" && r.cardId === 201);
		expect(sRow).toBeDefined();
		expect(sRow?.deckCount).toBe(1);
		expect(sRow?.copies1).toBe(0);
		expect(sRow?.copies2).toBe(1);
		expect(sRow?.copies3).toBe(0);

		// Trap: 3 copies of 301
		const tRow = result.find((r) => r.metric === "trap" && r.cardId === 301);
		expect(tRow).toBeDefined();
		expect(tRow?.deckCount).toBe(1);
		expect(tRow?.copies1).toBe(0);
		expect(tRow?.copies2).toBe(0);
		expect(tRow?.copies3).toBe(1);

		// Extra: 1 copy of 401
		const eRow = result.find((r) => r.metric === "extra" && r.cardId === 401);
		expect(eRow).toBeDefined();
		expect(eRow?.deckCount).toBe(1);
		expect(eRow?.copies1).toBe(1);
	});

	it("merges alternate artwork and original cards into canonical card ID and sums copies", () => {
		const calculator = new CardUsageCalculator(mockMetadataProvider, "1109", "2026-07-01");
		// Deck with 1 original (101) and 2 alt-art (102) -> total 3 copies of canonical 101
		const snapshot: PlayerMatchDeckSnapshot = {
			matchId: "m2",
			formatId: "1109",
			deckTypeCode: "D01",
			mainCards: [101, 102, 102],
			extraCards: [],
			sideCards: [],
		};

		const result = calculator.calculate([snapshot]);
		const mRow = result.find((r) => r.metric === "monster" && r.cardId === 101);
		expect(mRow).toBeDefined();
		expect(mRow?.deckCount).toBe(1);
		expect(mRow?.copies1).toBe(0);
		expect(mRow?.copies2).toBe(0);
		expect(mRow?.copies3).toBe(1);
		expect(result.some((r) => r.cardId === 102)).toBe(false);
	});

	it("keeps Main and Side slot counts completely independent", () => {
		const calculator = new CardUsageCalculator(mockMetadataProvider, "1109", "2026-07-01");
		// 501 is in Main (2 copies) and Side (1 copy)
		const snapshot: PlayerMatchDeckSnapshot = {
			matchId: "m3",
			formatId: "1109",
			deckTypeCode: "D01",
			mainCards: [501, 501],
			extraCards: [],
			sideCards: [501],
		};

		const result = calculator.calculate([snapshot]);

		const spellRow = result.find((r) => r.metric === "spell" && r.cardId === 501);
		expect(spellRow).toBeDefined();
		expect(spellRow?.deckCount).toBe(1);
		expect(spellRow?.copies2).toBe(1);

		const sideRow = result.find((r) => r.metric === "side" && r.cardId === 501);
		expect(sideRow).toBeDefined();
		expect(sideRow?.deckCount).toBe(1);
		expect(sideRow?.copies1).toBe(1);
	});

	it("distinguishes sideCards === null (skipped) from sideCards === [] (empty, 0 cards)", () => {
		const calculator = new CardUsageCalculator(mockMetadataProvider, "1109", "2026-07-01");

		const nullSideSnapshot: PlayerMatchDeckSnapshot = {
			matchId: "m4",
			formatId: "1109",
			deckTypeCode: "D01",
			mainCards: [201],
			extraCards: [],
			sideCards: null, // Unknown side
		};

		const emptySideSnapshot: PlayerMatchDeckSnapshot = {
			matchId: "m5",
			formatId: "1109",
			deckTypeCode: "D01",
			mainCards: [201],
			extraCards: [],
			sideCards: [], // Known empty side
		};

		const resultNull = calculator.calculate([nullSideSnapshot]);
		expect(resultNull.filter((r) => r.metric === "side")).toHaveLength(0);

		const resultEmpty = calculator.calculate([emptySideSnapshot]);
		expect(resultEmpty.filter((r) => r.metric === "side")).toHaveLength(0);
	});
});
