import { ReplayDuelSeatExtractor } from "./ReplayDuelSeatExtractor";
import { DuelRecordMother } from "@test-support/mothers/room/DuelRecordMother";
import YGOProDeck from "ygopro-deck-encode";

describe("ReplayDuelSeatExtractor (Task 3.1)", () => {
	let extractor: ReplayDuelSeatExtractor;

	beforeEach(() => {
		extractor = new ReplayDuelSeatExtractor();
	});

	function createReplayBytes(options: {
		hostName: string;
		clientName: string;
		isSwapped?: boolean;
	}): Buffer {
		const defaultDeck = new YGOProDeck({
			main: new Array(40).fill(46986414),
			extra: [83764718],
			side: [],
		});

		const record = DuelRecordMother.create({
			players: [
				{ name: options.hostName, deck: defaultDeck },
				{ name: options.clientName, deck: defaultDeck },
			],
			isSwapped: options.isSwapped ?? false,
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

	it("extracts host (first turn) and client (second turn) seats from G1 replay", () => {
		const yrpBytes = createReplayBytes({ hostName: "Alice", clientName: "Bob", isSwapped: false });
		const extracted = extractor.extractFromYrp(yrpBytes);

		expect(extracted).not.toBeNull();
		expect(extracted?.hostName).toBe("Alice");
		expect(extracted?.clientName).toBe("Bob");

		const seats = extractor.resolvePlayerSeats(extracted!, "Alice", "Bob");
		expect(seats).toEqual({ player1IsFirst: true, player2IsFirst: false });
	});

	it("handles swapped seats where Bob goes first in G2", () => {
		// When room position is swapped, Bob goes first
		const yrpBytes = createReplayBytes({ hostName: "Alice", clientName: "Bob", isSwapped: true });
		const extracted = extractor.extractFromYrp(yrpBytes);

		expect(extracted).not.toBeNull();
		expect(extracted?.hostName).toBe("Bob");
		expect(extracted?.clientName).toBe("Alice");

		// Resolve relative to players ("Alice", "Bob")
		const seats = extractor.resolvePlayerSeats(extracted!, "Alice", "Bob");
		expect(seats).toEqual({ player1IsFirst: false, player2IsFirst: true });
	});

	it("rejects ambiguous replays where hostName equals clientName", () => {
		const yrpBytes = createReplayBytes({ hostName: "Alice", clientName: "Alice" });
		const extracted = extractor.extractFromYrp(yrpBytes);

		expect(extracted).toBeNull();
	});

	it("returns null for resolvePlayerSeats when match player names are ambiguous or do not match", () => {
		const extracted = { hostName: "Alice", clientName: "Bob" };

		// Same names in match
		expect(extractor.resolvePlayerSeats(extracted, "Alice", "Alice")).toBeNull();

		// Mismatched names
		expect(extractor.resolvePlayerSeats(extracted, "Charlie", "Dave")).toBeNull();
		expect(extractor.resolvePlayerSeats(extracted, "Alice", "Charlie")).toBeNull();
	});

	it("returns null for corrupted, truncated, or tag replays", () => {
		// Null or empty buffer
		expect(extractor.extractFromYrp(null as any)).toBeNull();
		expect(extractor.extractFromYrp(Buffer.alloc(0))).toBeNull();
		expect(extractor.extractFromYrp(Buffer.alloc(20))).toBeNull();

		// Tag replay flag (bit 0x2 at flag offset 8)
		const tagBytes = Buffer.from(createReplayBytes({ hostName: "Alice", clientName: "Bob" }));
		tagBytes[8] |= 0x2;
		expect(extractor.extractFromYrp(tagBytes)).toBeNull();
	});
});
