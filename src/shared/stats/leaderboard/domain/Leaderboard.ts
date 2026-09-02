export type LeaderboardEntry = {
	rank: number;
	userId: string;
	username: string;
	points: number;
	wins: number;
	losses: number;
	winRate: number;
};

export type LeaderboardResponse = {
	format: string;
	scope: "season" | "overall";
	season?: string;
	page?: number;
	pageSize?: number;
	total?: number;
	leaderboard: LeaderboardEntry[];
};

export type PlayerPersonalStats = {
	format: string;
	season: string;
	points: number;
	wins: number;
	losses: number;
	winRate: number;
	rank: number | null;
};

export const SUPPORTED_LEADERBOARD_FORMATS = Object.freeze(["1103", "1109"] as const);
export type SupportedLeaderboardFormat = (typeof SUPPORTED_LEADERBOARD_FORMATS)[number];
