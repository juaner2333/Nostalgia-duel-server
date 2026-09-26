import { MatchDeckRepository } from "../domain/MatchDeckRepository";
import { DeckCompleteness, formatDeckToYdk, generateYdkFilename } from "../domain/DeckYdkFormatter";
import { SUPPORTED_REPLAY_FORMATS, SupportedReplayFormat } from "../../stats/replays/domain/Replay";

export interface DownloadMatchDeckRequest {
	format: string;
	matchId: string;
}

export interface DownloadMatchDeckResponse {
	matchId: string;
	formatId: string;
	filename: string;
	safeAsciiFilename: string;
	completeness: DeckCompleteness;
	ydkContent: string;
}

export class DownloadMatchDeck {
	constructor(private readonly repository: MatchDeckRepository) {}

	async run(request: DownloadMatchDeckRequest): Promise<DownloadMatchDeckResponse> {
		if (!SUPPORTED_REPLAY_FORMATS.includes(request.format as SupportedReplayFormat)) {
			throw new Error(`Invalid format: ${request.format}`);
		}

		const matchDeck = await this.repository.findByMatchId(request.format, request.matchId);
		if (!matchDeck) {
			throw new Error("Match deck snapshot not found");
		}

		const ydkContent = formatDeckToYdk({
			mainCards: matchDeck.mainCards,
			extraCards: matchDeck.extraCards,
			sideCards: matchDeck.sideCards,
		});

		const filename = generateYdkFilename({
			date: matchDeck.date,
			playerName: matchDeck.playerName,
			opponentName: matchDeck.opponentName,
			completeness: matchDeck.completeness,
		});

		const safeAsciiFilename = `match-${request.matchId.replace(/[^a-zA-Z0-9_-]/g, "")}-${matchDeck.completeness}.ydk`;

		return {
			matchId: matchDeck.matchId,
			formatId: matchDeck.formatId,
			filename,
			safeAsciiFilename,
			completeness: matchDeck.completeness,
			ydkContent,
		};
	}
}
