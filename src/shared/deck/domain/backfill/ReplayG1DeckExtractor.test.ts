import { ReplayG1DeckExtractor } from "./ReplayG1DeckExtractor";
import { DuelRecordMother } from "@test-support/mothers/room/DuelRecordMother";
import YGOProDeck from "ygopro-deck-encode";

describe("ReplayG1DeckExtractor (Task 7.1)", () => {
	let extractor: ReplayG1DeckExtractor;

	beforeEach(() => {
		extractor = new ReplayG1DeckExtractor();
	});

	function createSampleYrpBytes(options?: {
		p1Deck?: { main: number[]; extra: number[]; side: number[] };
		p2Deck?: { main: number[]; extra: number[]; side: number[] };
		p1Name?: string;
		p2Name?: string;
	}): Buffer {
		const mainP1 = options?.p1Deck?.main ?? new Array(40).fill(46986414); // 40x Dark Magician
		const extraP1 = options?.p1Deck?.extra ?? [83764718]; // 1x Monster
		const mainP2 = options?.p2Deck?.main ?? new Array(40).fill(33398782);
		const extraP2 = options?.p2Deck?.extra ?? [83764718, 83764718];

		const record = DuelRecordMother.create({
			players: [
				{
					name: options?.p1Name ?? "Alice",
					deck: new YGOProDeck({ main: mainP1, extra: extraP1, side: [18964575] }),
				},
				{
					name: options?.p2Name ?? "Bob",
					deck: new YGOProDeck({ main: mainP2, extra: extraP2, side: [18964575] }),
				},
			],
		});

		const mockRoom = {
			hostInfo: {
				start_lp: 8000,
				start_hand: 5,
				draw_count: 1,
				rule: 2,
				mode: 1,
				duel_rule: 2,
				no_check_deck: 0,
				no_shuffle_deck: 0,
				best_of: 3,
				max_deck_points: 0,
				lflist: 0,
				time_limit: 180,
			},
			isTag: false,
		};

		const yrp = record.toYrp(mockRoom);
		return Buffer.from(yrp.toYrp());
	}

	it("extracts host and client decks with exact duplicates and null side cards", () => {
		// Main with 3 copies of card A, 37 copies of card B
		const p1Main = [46986414, 46986414, 46986414, ...new Array(37).fill(33398782)];
		const p1Extra = [83764718, 83764718];

		const yrpBytes = createSampleYrpBytes({
			p1Name: "Alice",
			p2Name: "Bob",
			p1Deck: { main: p1Main, extra: p1Extra, side: [12345] },
		});

		const extracted = extractor.extractFromYrp(yrpBytes);

		expect(extracted).not.toBeNull();
		expect(extracted?.hostName).toBe("Alice");
		expect(extracted?.clientName).toBe("Bob");

		// Host deck
		expect(extracted?.hostDeck.mainCards).toHaveLength(40);
		expect(extracted?.hostDeck.mainCards.filter((id) => id === 46986414)).toHaveLength(3);
		expect(extracted?.hostDeck.mainCards.filter((id) => id === 33398782)).toHaveLength(37);
		expect(extracted?.hostDeck.extraCards).toEqual([83764718, 83764718]);
		// Side cards must be NULL because replay binary does not persist initial side deck
		expect(extracted?.hostDeck.sideCards).toBeNull();

		// Client deck
		expect(extracted?.clientDeck.mainCards).toHaveLength(40);
		expect(extracted?.clientDeck.extraCards).toHaveLength(2);
		expect(extracted?.clientDeck.sideCards).toBeNull();
	});

	it("rejects corrupted or truncated replay data", () => {
		const corrupted = Buffer.from([0x00, 0x01, 0x02, 0x03]);
		expect(extractor.extractFromYrp(corrupted)).toBeNull();
	});

	it("rejects replays with invalid deck sizes (< 40 or > 60 main cards)", () => {
		const smallMain = createSampleYrpBytes({
			p1Deck: { main: new Array(30).fill(46986414), extra: [], side: [] },
		});
		expect(extractor.extractFromYrp(smallMain)).toBeNull();
	});

	it("correctly identifies YRP2 magic header (0x32707279)", () => {
		const yrpBytes = createSampleYrpBytes();
		// First 4 bytes in LE: 0x79, 0x72, 0x70, 0x32 ("yrp2")
		expect(yrpBytes.readUInt32LE(0)).toBe(0x32707279);
		const extracted = extractor.extractFromYrp(yrpBytes);
		expect(extracted).not.toBeNull();
	});
});
