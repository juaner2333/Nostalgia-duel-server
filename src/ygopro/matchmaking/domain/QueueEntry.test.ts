import { MATCHMAKING_FORMATS, MatchmakingFormat } from "./QueueEntry";

describe("MATCHMAKING_FORMATS", () => {
	it('is exactly ["1103","1109"] as a const array', () => {
		expect(MATCHMAKING_FORMATS).toEqual(["1103", "1109"]);
	});

	it("contains only non-empty, unique format strings", () => {
		const seen = new Set<string>();
		for (const fmt of MATCHMAKING_FORMATS) {
			expect(typeof fmt).toBe("string");
			expect(fmt.length).toBeGreaterThan(0);
			expect(seen.has(fmt)).toBe(false);
			seen.add(fmt);
		}
	});
});

describe("MatchmakingFormat", () => {
	it('accepts "1103" as a valid MatchmakingFormat', () => {
		const fmt: MatchmakingFormat = "1103";
		expect(MATCHMAKING_FORMATS as readonly string[]).toContain(fmt);
	});

	it('accepts "1109" as a valid MatchmakingFormat', () => {
		const fmt: MatchmakingFormat = "1109";
		expect(MATCHMAKING_FORMATS as readonly string[]).toContain(fmt);
	});
});
