import { LeaderboardEntry, PlayerPersonalStats } from "./Leaderboard";

export interface LeaderboardQueryOptions {
	search?: string;
	page?: number;
	pageSize?: number;
}

export interface LeaderboardQueryResult {
	entries: LeaderboardEntry[];
	total: number;
}

export interface LeaderboardRepository {
	getSeasonLeaderboard(
		formatId: string,
		season: number,
		options?: LeaderboardQueryOptions,
	): Promise<LeaderboardQueryResult | LeaderboardEntry[]>;
	getOverallLeaderboard(
		formatId: string,
		options?: LeaderboardQueryOptions,
	): Promise<LeaderboardQueryResult | LeaderboardEntry[]>;
	getPlayerMonthlyStats(
		userId: string,
		formatId: string,
		season: number,
	): Promise<PlayerPersonalStats>;
}
