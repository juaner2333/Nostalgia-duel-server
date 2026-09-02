import { LeaderboardEntry, PlayerPersonalStats } from "./Leaderboard";

export interface LeaderboardRepository {
	getSeasonLeaderboard(formatId: string, season: number): Promise<LeaderboardEntry[]>;
	getOverallLeaderboard(formatId: string): Promise<LeaderboardEntry[]>;
	getPlayerMonthlyStats(
		userId: string,
		formatId: string,
		season: number,
	): Promise<PlayerPersonalStats>;
}
