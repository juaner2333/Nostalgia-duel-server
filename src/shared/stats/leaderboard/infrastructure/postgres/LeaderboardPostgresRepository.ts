import { dataSource } from "../../../../../evolution-types/src/data-source";
import { LeaderboardEntry, PlayerPersonalStats } from "../../domain/Leaderboard";
import {
	HalfYearSeasonRange,
	LeaderboardQueryOptions,
	LeaderboardQueryResult,
	LeaderboardRepository,
} from "../../domain/LeaderboardRepository";
import { parseHalfYearSeason } from "src/utils/calculateBeijingSeason";

export function escapeLike(str: string): string {
	return str.replace(/[%_\\]/g, "\\$&");
}

export class LeaderboardPostgresRepository implements LeaderboardRepository {
	async getSeasonLeaderboard(
		formatId: string,
		season: string | HalfYearSeasonRange | number,
		options?: LeaderboardQueryOptions,
	): Promise<LeaderboardQueryResult> {
		let startMonth: number;
		let endMonth: number;

		if (typeof season === "string") {
			const halfYear = parseHalfYearSeason(season);
			startMonth = halfYear.startMonth;
			endMonth = halfYear.endMonth;
		} else if (typeof season === "number") {
			startMonth = season;
			endMonth = season;
		} else {
			startMonth = season.startMonth;
			endMonth = season.endMonth;
		}

		const search = options?.search?.trim();
		const page = options?.page;
		const pageSize = options?.pageSize;
		const params: any[] = [formatId, startMonth, endMonth];

		let searchClause = "";
		if (search) {
			params.push(`%${escapeLike(search)}%`);
			searchClause = `WHERE "username" ILIKE $${params.length}`;
		}

		let paginationClause = "";
		if (page !== undefined && pageSize !== undefined) {
			const offset = (page - 1) * pageSize;
			params.push(pageSize, offset);
			paginationClause = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
		} else if (pageSize !== undefined) {
			params.push(pageSize);
			paginationClause = `LIMIT $${params.length}`;
		}

		const sql = `
			WITH aggregated_stats AS (
				SELECT
					ps.user_id AS "userId",
					COALESCE(u.username, '未知玩家') AS "username",
					SUM(ps.points)::int AS "points",
					SUM(ps.wins)::int AS "wins",
					SUM(ps.losses)::int AS "losses"
				FROM player_stats ps
				LEFT JOIN users u ON u.id = ps.user_id
				WHERE ps.format_id = $1 AND ps.season BETWEEN $2 AND $3
				GROUP BY ps.user_id, u.username
				HAVING (SUM(ps.wins) + SUM(ps.losses)) > 0
			),
			ranked_stats AS (
				SELECT
					"userId",
					"username",
					"points",
					"wins",
					"losses",
					ROW_NUMBER() OVER (ORDER BY "points" DESC, "wins" DESC, "username" ASC) AS "rank"
				FROM aggregated_stats
			)
			SELECT
				"userId",
				"username",
				"points",
				"wins",
				"losses",
				"rank",
				COUNT(*) OVER() AS "totalCount"
			FROM ranked_stats
			${searchClause}
			ORDER BY "rank" ASC
			${paginationClause}
		`;

		const rows: Array<{
			userId: string;
			username: string;
			points: number | string;
			wins: number | string;
			losses: number | string;
			rank: number | string;
			totalCount: number | string;
		}> = await dataSource.query(sql, params);

		const total = rows.length > 0 ? Number(rows[0].totalCount) : 0;
		const entries: LeaderboardEntry[] = rows.map((row) => {
			const wins = Number(row.wins);
			const losses = Number(row.losses);
			const points = Number(row.points);
			const rank = Number(row.rank);
			const totalGames = wins + losses;
			const winRate = totalGames > 0 ? Number((wins / totalGames).toFixed(4)) : 0;

			return {
				rank,
				userId: row.userId,
				username: row.username,
				points,
				wins,
				losses,
				winRate,
			};
		});

		return { entries, total };
	}

	async getOverallLeaderboard(
		formatId: string,
		options?: LeaderboardQueryOptions,
	): Promise<LeaderboardQueryResult> {
		const search = options?.search?.trim();
		const page = options?.page;
		const pageSize = options?.pageSize;
		const params: any[] = [formatId];

		let searchClause = "";
		if (search) {
			params.push(`%${escapeLike(search)}%`);
			searchClause = `WHERE "username" ILIKE $${params.length}`;
		}

		let paginationClause = "";
		if (page !== undefined && pageSize !== undefined) {
			const offset = (page - 1) * pageSize;
			params.push(pageSize, offset);
			paginationClause = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
		} else if (pageSize !== undefined) {
			params.push(pageSize);
			paginationClause = `LIMIT $${params.length}`;
		}

		const sql = `
			WITH aggregated_stats AS (
				SELECT
					ps.user_id AS "userId",
					COALESCE(u.username, '未知玩家') AS "username",
					SUM(ps.points)::int AS "points",
					SUM(ps.wins)::int AS "wins",
					SUM(ps.losses)::int AS "losses"
				FROM player_stats ps
				LEFT JOIN users u ON u.id = ps.user_id
				WHERE ps.format_id = $1
				GROUP BY ps.user_id, u.username
				HAVING (SUM(ps.wins) + SUM(ps.losses)) > 0
			),
			ranked_stats AS (
				SELECT
					"userId",
					"username",
					"points",
					"wins",
					"losses",
					ROW_NUMBER() OVER (ORDER BY "points" DESC, "wins" DESC, "username" ASC) AS "rank"
				FROM aggregated_stats
			)
			SELECT
				"userId",
				"username",
				"points",
				"wins",
				"losses",
				"rank",
				COUNT(*) OVER() AS "totalCount"
			FROM ranked_stats
			${searchClause}
			ORDER BY "rank" ASC
			${paginationClause}
		`;

		const rows: Array<{
			userId: string;
			username: string;
			points: number | string;
			wins: number | string;
			losses: number | string;
			rank: number | string;
			totalCount: number | string;
		}> = await dataSource.query(sql, params);

		const total = rows.length > 0 ? Number(rows[0].totalCount) : 0;
		const entries: LeaderboardEntry[] = rows.map((row) => {
			const wins = Number(row.wins);
			const losses = Number(row.losses);
			const points = Number(row.points);
			const rank = Number(row.rank);
			const totalGames = wins + losses;
			const winRate = totalGames > 0 ? Number((wins / totalGames).toFixed(4)) : 0;

			return {
				rank,
				userId: row.userId,
				username: row.username,
				points,
				wins,
				losses,
				winRate,
			};
		});

		return { entries, total };
	}

	async getPlayerSeasonStats(
		userId: string,
		formatId: string,
		season: string,
	): Promise<PlayerPersonalStats> {
		const halfYear = parseHalfYearSeason(season);
		const res = await this.getSeasonLeaderboard(formatId, halfYear);
		const entries = Array.isArray(res) ? res : res.entries;
		const userEntry = entries.find((entry) => entry.userId === userId);

		if (!userEntry) {
			return {
				format: formatId,
				season: halfYear.label,
				points: 0,
				wins: 0,
				losses: 0,
				winRate: 0,
				rank: null,
			};
		}

		return {
			format: formatId,
			season: halfYear.label,
			points: userEntry.points,
			wins: userEntry.wins,
			losses: userEntry.losses,
			winRate: userEntry.winRate,
			rank: userEntry.rank,
		};
	}

	async getPlayerMonthlyStats(
		userId: string,
		formatId: string,
		season: number | string,
	): Promise<PlayerPersonalStats> {
		if (typeof season === "string" && /^(\d{4})H[12]$/.test(season)) {
			return this.getPlayerSeasonStats(userId, formatId, season);
		}
		const numericSeason =
			typeof season === "number" ? season : parseInt(season.replace("-", ""), 10);
		const seasonStr =
			typeof season === "string"
				? season
				: `${Math.floor(season / 100)}-${String(season % 100).padStart(2, "0")}`;
		const res = await this.getSeasonLeaderboard(formatId, numericSeason);
		const entries = Array.isArray(res) ? res : res.entries;
		const userEntry = entries.find((entry) => entry.userId === userId);

		if (!userEntry) {
			return {
				format: formatId,
				season: seasonStr,
				points: 0,
				wins: 0,
				losses: 0,
				winRate: 0,
				rank: null,
			};
		}

		return {
			format: formatId,
			season: seasonStr,
			points: userEntry.points,
			wins: userEntry.wins,
			losses: userEntry.losses,
			winRate: userEntry.winRate,
			rank: userEntry.rank,
		};
	}
}
