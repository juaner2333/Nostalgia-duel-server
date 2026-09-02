import { dataSource } from "../../../../../evolution-types/src/data-source";
import { LeaderboardEntry, PlayerPersonalStats } from "../../domain/Leaderboard";
import { LeaderboardRepository } from "../../domain/LeaderboardRepository";

export class LeaderboardPostgresRepository implements LeaderboardRepository {
	async getSeasonLeaderboard(formatId: string, season: number): Promise<LeaderboardEntry[]> {
		const sql = `
			SELECT
				ps.user_id AS "userId",
				u.username AS "username",
				ps.points AS "points",
				ps.wins AS "wins",
				ps.losses AS "losses"
			FROM player_stats ps
			JOIN users u ON u.id = ps.user_id
			WHERE ps.format_id = $1 AND ps.season = $2 AND (ps.wins + ps.losses) > 0
			ORDER BY ps.points DESC, ps.wins DESC, u.username ASC
		`;

		const rows: Array<{
			userId: string;
			username: string;
			points: number | string;
			wins: number | string;
			losses: number | string;
		}> = await dataSource.query(sql, [formatId, season]);

		return rows.map((row, index) => {
			const wins = Number(row.wins);
			const losses = Number(row.losses);
			const points = Number(row.points);
			const total = wins + losses;
			const winRate = total > 0 ? Number((wins / total).toFixed(4)) : 0;

			return {
				rank: index + 1,
				userId: row.userId,
				username: row.username,
				points,
				wins,
				losses,
				winRate,
			};
		});
	}

	async getOverallLeaderboard(formatId: string): Promise<LeaderboardEntry[]> {
		const sql = `
			SELECT
				ps.user_id AS "userId",
				u.username AS "username",
				SUM(ps.points)::int AS "points",
				SUM(ps.wins)::int AS "wins",
				SUM(ps.losses)::int AS "losses"
			FROM player_stats ps
			JOIN users u ON u.id = ps.user_id
			WHERE ps.format_id = $1
			GROUP BY ps.user_id, u.username
			HAVING (SUM(ps.wins) + SUM(ps.losses)) > 0
			ORDER BY "points" DESC, "wins" DESC, u.username ASC
		`;

		const rows: Array<{
			userId: string;
			username: string;
			points: number | string;
			wins: number | string;
			losses: number | string;
		}> = await dataSource.query(sql, [formatId]);

		return rows.map((row, index) => {
			const wins = Number(row.wins);
			const losses = Number(row.losses);
			const points = Number(row.points);
			const total = wins + losses;
			const winRate = total > 0 ? Number((wins / total).toFixed(4)) : 0;

			return {
				rank: index + 1,
				userId: row.userId,
				username: row.username,
				points,
				wins,
				losses,
				winRate,
			};
		});
	}

	async getPlayerMonthlyStats(
		userId: string,
		formatId: string,
		season: number,
	): Promise<PlayerPersonalStats> {
		const seasonStr = `${Math.floor(season / 100)}-${String(season % 100).padStart(2, "0")}`;
		const leaderboard = await this.getSeasonLeaderboard(formatId, season);
		const userEntry = leaderboard.find((entry) => entry.userId === userId);

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
