import { MATCHMAKING_FORMATS } from "./QueueEntry";
import { pickBotFromRoster, MATCHMAKING_BOT_ROSTER } from "./MatchmakingBotRoster";

describe("MATCHMAKING_BOT_ROSTER", () => {
	it("has a non-empty roster for every enabled format", () => {
		for (const format of MATCHMAKING_FORMATS) {
			expect(MATCHMAKING_BOT_ROSTER[format]).toHaveLength(1);
		}
	});

	it("contains fixed-format identities", () => {
		expect(MATCHMAKING_BOT_ROSTER["1103"][0]).toEqual({ name: "Yugi", deck: "Yugi" });
		expect(MATCHMAKING_BOT_ROSTER["1109"][0]).toEqual({ name: "Joey", deck: "Joey" });
	});
});

describe("pickBotFromRoster", () => {
	it.each(MATCHMAKING_FORMATS)("returns the configured %s identity", (format) => {
		expect(pickBotFromRoster(format, () => 1)).toEqual(MATCHMAKING_BOT_ROSTER[format][0]);
	});
});
