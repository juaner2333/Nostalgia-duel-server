import { DeckCompleteness } from "./DeckYdkFormatter";

export interface MatchDeckDetails {
	matchId: string;
	formatId: string;
	date: Date;
	playerName: string;
	opponentName: string;
	mainCards: number[];
	extraCards: number[];
	sideCards: number[] | null;
	completeness: DeckCompleteness;
}

export interface MatchDeckRepository {
	findByMatchId(formatId: string, matchId: string): Promise<MatchDeckDetails | null>;
}
