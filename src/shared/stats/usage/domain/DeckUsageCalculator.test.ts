import { DeckUsageCalculator, PlayerMatchDeckSnapshot } from "./DeckUsageCalculator";

describe("DeckUsageCalculator", () => {
	const validMain40 = Array(40).fill(10000);
	const validExtra15 = Array(15).fill(20000);

	it("counts player-perspective valid snapshots, handling Bo3 and mirror matches correctly", () => {
		const calculator = new DeckUsageCalculator("1109");

		// Bo3 match between player A (D01) and player B (D01) -> 2 player-perspective snapshots
		const snapshots: PlayerMatchDeckSnapshot[] = [
			{
				matchId: "m1-p1",
				formatId: "1109",
				deckTypeCode: "D01",
				mainCards: validMain40,
				extraCards: validExtra15,
				sideCards: [30000],
			},
			{
				matchId: "m1-p2",
				formatId: "1109",
				deckTypeCode: "D01",
				mainCards: validMain40,
				extraCards: validExtra15,
				sideCards: null, // Side unknown
			},
		];

		const result = calculator.calculate(snapshots);
		expect(result.totalDecks).toBe(2);
		expect(result.sideKnownDecks).toBe(1);
		expect(result.deckCounts.get("D01")).toBe(2);
	});

	it("skips one side when snapshot is missing or invalid, without counting into OTHERS", () => {
		const calculator = new DeckUsageCalculator("1109");

		const snapshots: (PlayerMatchDeckSnapshot | null)[] = [
			{
				matchId: "m2-p1",
				formatId: "1109",
				deckTypeCode: "D03",
				mainCards: validMain40,
				extraCards: validExtra15,
				sideCards: [], // Known empty side
			},
			null, // Player 2 has no snapshot
			{
				matchId: "m3-p1",
				formatId: "1109",
				deckTypeCode: "D04",
				mainCards: Array(30).fill(10000), // Invalid main < 40
				extraCards: [],
				sideCards: null,
			},
		];

		const result = calculator.calculate(snapshots);
		expect(result.totalDecks).toBe(1);
		expect(result.sideKnownDecks).toBe(1); // empty array is known side
		expect(result.deckCounts.get("D03")).toBe(1);
		expect(result.deckCounts.has("OTHERS")).toBe(false);
		expect(result.skippedCount).toBe(2);
	});

	it("ignores annulled and soft-deleted matches", () => {
		const calculator = new DeckUsageCalculator("1109");

		const snapshots: PlayerMatchDeckSnapshot[] = [
			{
				matchId: "m4-p1",
				formatId: "1109",
				deckTypeCode: "D02",
				mainCards: validMain40,
				extraCards: [],
				sideCards: [],
				isAnnulled: true,
			},
			{
				matchId: "m5-p1",
				formatId: "1109",
				deckTypeCode: "D02",
				mainCards: validMain40,
				extraCards: [],
				sideCards: [],
				isDeleted: true,
			},
			{
				matchId: "m6-p1",
				formatId: "1109",
				deckTypeCode: "D02",
				mainCards: validMain40,
				extraCards: [],
				sideCards: [],
			},
		];

		const result = calculator.calculate(snapshots);
		expect(result.totalDecks).toBe(1);
		expect(result.deckCounts.get("D02")).toBe(1);
	});

	it("allows only OTHERS for 1103 and rejects non-OTHERS deck types for 1103", () => {
		const calculator = new DeckUsageCalculator("1103");

		const snapshots: PlayerMatchDeckSnapshot[] = [
			{
				matchId: "m7-p1",
				formatId: "1103",
				deckTypeCode: "OTHERS",
				mainCards: validMain40,
				extraCards: [],
				sideCards: null,
			},
			{
				matchId: "m7-p2",
				formatId: "1103",
				deckTypeCode: "D01", // Invalid for 1103!
				mainCards: validMain40,
				extraCards: [],
				sideCards: null,
			},
		];

		const result = calculator.calculate(snapshots);
		expect(result.totalDecks).toBe(1);
		expect(result.deckCounts.get("OTHERS")).toBe(1);
		expect(result.skippedCount).toBe(1);
	});

	it("accepts OTHERS for 1109 as a valid category", () => {
		const calculator = new DeckUsageCalculator("1109");

		const snapshots: PlayerMatchDeckSnapshot[] = [
			{
				matchId: "m8-p1",
				formatId: "1109",
				deckTypeCode: "OTHERS",
				mainCards: validMain40,
				extraCards: [],
				sideCards: [],
			},
		];

		const result = calculator.calculate(snapshots);
		expect(result.totalDecks).toBe(1);
		expect(result.deckCounts.get("OTHERS")).toBe(1);
	});
});
