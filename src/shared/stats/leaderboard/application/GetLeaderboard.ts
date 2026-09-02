import { LeaderboardRepository } from "../domain/LeaderboardRepository";
import {
	LeaderboardResponse,
	SUPPORTED_LEADERBOARD_FORMATS,
	SupportedLeaderboardFormat,
} from "../domain/Leaderboard";

export type GetLeaderboardRequest = {
	format: string;
	scope: "season" | "overall";
	season?: string;
};

export class GetLeaderboard {
	constructor(private readonly repository: LeaderboardRepository) {}

	async run(request: GetLeaderboardRequest): Promise<LeaderboardResponse> {
		if (!SUPPORTED_LEADERBOARD_FORMATS.includes(request.format as SupportedLeaderboardFormat)) {
			throw new Error(`Invalid format: must be one of ${SUPPORTED_LEADERBOARD_FORMATS.join(", ")}`);
		}

		if (request.scope === "overall") {
			if (request.season !== undefined) {
				throw new Error("The 'season' parameter is not allowed when scope is 'overall'");
			}
			const leaderboard = await this.repository.getOverallLeaderboard(request.format);

			return {
				format: request.format,
				scope: "overall",
				leaderboard,
			};
		}

		if (request.scope === "season") {
			if (!request.season || !/^\d{4}-\d{2}$/.test(request.season)) {
				throw new Error("Invalid season: format must be YYYY-MM");
			}

			const numericSeason = parseInt(request.season.replace("-", ""), 10);
			const leaderboard = await this.repository.getSeasonLeaderboard(request.format, numericSeason);

			return {
				format: request.format,
				scope: "season",
				season: request.season,
				leaderboard,
			};
		}

		throw new Error("Invalid scope: must be season or overall");
	}
}
