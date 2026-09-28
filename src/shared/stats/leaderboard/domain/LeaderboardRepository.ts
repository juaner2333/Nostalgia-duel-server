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

export type HalfYearSeasonRange = {
	startMonth: number;
	endMonth: number;
	label?: string;
};

export interface LeaderboardRepository {
	getSeasonLeaderboard(
		formatId: string,
		season: string | HalfYearSeasonRange | number,
		options?: LeaderboardQueryOptions,
	): Promise<LeaderboardQueryResult | LeaderboardEntry[]>;
	getOverallLeaderboard(
		formatId: string,
		options?: LeaderboardQueryOptions,
	): Promise<LeaderboardQueryResult | LeaderboardEntry[]>;
	getPlayerSeasonStats(
		userId: string,
		formatId: string,
		season: string,
	): Promise<PlayerPersonalStats>;
	getPlayerMonthlyStats(
		userId: string,
		formatId: string,
		season: number | string,
	): Promise<PlayerPersonalStats>;
}
