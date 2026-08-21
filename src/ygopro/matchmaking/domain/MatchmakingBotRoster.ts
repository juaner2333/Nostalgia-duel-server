import { MatchmakingFormat } from "./QueueEntry";

export interface BotIdentity {
	readonly name: string;
	readonly deck: string;
}

/** Fixed-format bot identities. Decks must remain legal for their format. */
export const MATCHMAKING_BOT_ROSTER: Record<MatchmakingFormat, readonly BotIdentity[]> = {
	"1103": [{ name: "Yugi", deck: "Yugi" }],
	"1109": [{ name: "Joey", deck: "Joey" }],
};

export function pickBotFromRoster(
	format: MatchmakingFormat,
	random: () => number = Math.random,
): BotIdentity {
	const roster = MATCHMAKING_BOT_ROSTER[format];
	const index = Math.min(Math.floor(random() * roster.length), roster.length - 1);
	return roster[index];
}
