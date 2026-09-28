import {
	UsageConsistencyValidator,
	UsageStatRunData,
	UsageDeckRowData,
} from "./UsageConsistencyValidator";
import { CardUsageRow } from "./CardUsageCalculator";

describe("UsageConsistencyValidator", () => {
	const validRun: UsageStatRunData = {
		formatId: "1109",
		windowStart: "2026-07-01",
		windowEndExclusive: "2027-01-01",
		dataEndExclusive: "2026-09-27",
		totalDecks: 10,
		sideKnownDecks: 8,
		publishedAt: new Date(),
	};

	const validDeckRows: UsageDeckRowData[] = [
		{ formatId: "1109", windowStart: "2026-07-01", deckTypeCode: "D01", deckCount: 6 },
		{ formatId: "1109", windowStart: "2026-07-01", deckTypeCode: "OTHERS", deckCount: 4 },
	];

	const validCardRows: CardUsageRow[] = [
		{
			formatId: "1109",
			windowStart: "2026-07-01",
			metric: "monster",
			cardId: 10000,
			deckCount: 5,
			copies1: 2,
			copies2: 3,
			copies3: 0,
		},
		{
			formatId: "1109",
			windowStart: "2026-07-01",
			metric: "side",
			cardId: 20000,
			deckCount: 7,
			copies1: 4,
			copies2: 2,
			copies3: 1,
		},
	];

	it("passes valid run, deck rows, and card rows", () => {
		expect(() =>
			UsageConsistencyValidator.validate(validRun, validDeckRows, validCardRows),
		).not.toThrow();
	});

	it("supports zero denominator empty window", () => {
		const emptyRun: UsageStatRunData = {
			...validRun,
			totalDecks: 0,
			sideKnownDecks: 0,
		};
		expect(() => UsageConsistencyValidator.validate(emptyRun, [], [])).not.toThrow();
	});

	it("rejects when sum of deck counts does not equal totalDecks", () => {
		const mismatchedDeckRows: UsageDeckRowData[] = [
			{ formatId: "1109", windowStart: "2026-07-01", deckTypeCode: "D01", deckCount: 5 }, // 5 != 10
		];
		expect(() =>
			UsageConsistencyValidator.validate(validRun, mismatchedDeckRows, validCardRows),
		).toThrow(/Sum of deck row counts \(5\) does not match totalDecks \(10\)/);
	});

	it("rejects deck type code not belonging to the format", () => {
		const run1103: UsageStatRunData = {
			...validRun,
			formatId: "1103",
			totalDecks: 5,
			sideKnownDecks: 5,
		};
		const invalidDeck1103: UsageDeckRowData[] = [
			{ formatId: "1103", windowStart: "2026-07-01", deckTypeCode: "D01", deckCount: 5 }, // D01 only exists for 1109
		];
		expect(() => UsageConsistencyValidator.validate(run1103, invalidDeck1103, [])).toThrow(
			/Deck type code D01 not allowed in format 1103/,
		);
	});

	it("rejects card bucket sum mismatch", () => {
		const badCardRows: CardUsageRow[] = [
			{
				formatId: "1109",
				windowStart: "2026-07-01",
				metric: "monster",
				cardId: 10000,
				deckCount: 5,
				copies1: 2,
				copies2: 1,
				copies3: 1, // 2+1+1 = 4 != 5
			},
		];
		expect(() => UsageConsistencyValidator.validate(validRun, validDeckRows, badCardRows)).toThrow(
			/copies sum \(2\+1\+1\) != deckCount \(5\)/,
		);
	});

	it("rejects card deck count exceeding totalDecks", () => {
		const exceedingCardRows: CardUsageRow[] = [
			{
				formatId: "1109",
				windowStart: "2026-07-01",
				metric: "monster",
				cardId: 10000,
				deckCount: 15, // 15 > totalDecks (10)
				copies1: 15,
				copies2: 0,
				copies3: 0,
			},
		];
		expect(() =>
			UsageConsistencyValidator.validate(validRun, validDeckRows, exceedingCardRows),
		).toThrow(/exceeds totalDecks/);
	});

	it("rejects side card deck count exceeding sideKnownDecks", () => {
		const exceedingSideCardRows: CardUsageRow[] = [
			{
				formatId: "1109",
				windowStart: "2026-07-01",
				metric: "side",
				cardId: 20000,
				deckCount: 9, // 9 > sideKnownDecks (8)
				copies1: 9,
				copies2: 0,
				copies3: 0,
			},
		];
		expect(() =>
			UsageConsistencyValidator.validate(validRun, validDeckRows, exceedingSideCardRows),
		).toThrow(/exceeds sideKnownDecks/);
	});
});
