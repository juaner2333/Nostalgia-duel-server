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
	search?: string;
	page?: number;
	pageSize?: number;
};

export class GetLeaderboard {
	constructor(private readonly repository: LeaderboardRepository) {}

	async run(request: GetLeaderboardRequest): Promise<LeaderboardResponse> {
		if (!SUPPORTED_LEADERBOARD_FORMATS.includes(request.format as SupportedLeaderboardFormat)) {
			throw new Error(`Invalid format: must be one of ${SUPPORTED_LEADERBOARD_FORMATS.join(", ")}`);
		}

		const options = {
			search: request.search?.trim() ? request.search.trim() : undefined,
			page: request.page,
			pageSize: request.pageSize,
		};

		if (request.scope === "overall") {
			if (request.season !== undefined) {
				throw new Error("The 'season' parameter is not allowed when scope is 'overall'");
			}
			const result = await this.repository.getOverallLeaderboard(request.format, options);
			const entries = Array.isArray(result) ? result : result.entries;
			const total = Array.isArray(result) ? result.length : result.total;

			return {
				format: request.format,
				scope: "overall",
				page: request.page,
				pageSize: request.pageSize,
				total,
				leaderboard: entries,
			};
		}

		if (request.scope === "season") {
			if (!request.season) {
				throw new Error("Invalid season: format must be YYYY-MM");
			}

			const str = String(request.season).trim();
			let normalizedYear = "";
			let monthNumber = 0;

			const m1 =
				str.match(/^(\d{4})[^\d]?(\d{1,2})[^\d]?$/) || str.match(/^(\d{4})[^\d]+(\d{1,2})/);
			if (m1) {
				normalizedYear = m1[1];
				monthNumber = parseInt(m1[2], 10);
			} else {
				const m2 = str.match(/^(\d{2})[^\d]+(\d{1,2})/);
				if (m2) {
					const y2 = parseInt(m2[1], 10);
					normalizedYear = y2 < 50 ? String(2000 + y2) : String(1900 + y2);
					monthNumber = parseInt(m2[2], 10);
				} else {
					const m3 = str.match(/^(\d{4})(\d{2})$/);
					if (m3) {
						normalizedYear = m3[1];
						monthNumber = parseInt(m3[2], 10);
					}
				}
			}

			if (!normalizedYear || monthNumber < 1 || monthNumber > 12) {
				throw new Error("Invalid season: format must be YYYY-MM (e.g. 2026-02)");
			}

			const normalizedMonth = monthNumber < 10 ? `0${monthNumber}` : String(monthNumber);
			const normalizedSeason = `${normalizedYear}-${normalizedMonth}`;
			const numericSeason = parseInt(`${normalizedYear}${normalizedMonth}`, 10);

			const result = await this.repository.getSeasonLeaderboard(
				request.format,
				numericSeason,
				options,
			);
			const entries = Array.isArray(result) ? result : result.entries;
			const total = Array.isArray(result) ? result.length : result.total;

			return {
				format: request.format,
				scope: "season",
				season: normalizedSeason,
				page: request.page,
				pageSize: request.pageSize,
				total,
				leaderboard: entries,
			};
		}

		throw new Error("Invalid scope: must be season or overall");
	}
}
