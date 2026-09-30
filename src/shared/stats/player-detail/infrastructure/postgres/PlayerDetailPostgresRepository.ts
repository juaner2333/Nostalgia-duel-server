import { dataSource } from "../../../../../evolution-types/src/data-source";
import { BeijingHalfYearSeason } from "src/utils/calculateBeijingSeason";
import { PlayerDeckStatDto, PlayerSummaryDto } from "../../domain/PlayerDetailDto";
import {
	PlayerDetailRepository,
	RawPlayerMatchDeckRow,
	RawPlayerMatchDuelRow,
	RawPlayerMatchRow,
} from "../../domain/PlayerDetailRepository";
import { calculateG1FirstRate, calculateWinRate } from "../../domain/PlayerDetailRules";

export class PlayerDetailPostgresRepository implements PlayerDetailRepository {
	/**
	 * 查询玩家全时期天梯摘要
	 * 业务决策（Trade-off）：
	 * 采用数据库端 CTE 结合窗口函数计算全局精准排名，仅返回目标玩家单行记录，
	 * 彻底避免在 Node 进程内存中加载全天梯榜单导致的 OOM 及 GC 停顿风险。
	 */
	async getPlayerOverallSummary(userId: string, formatId: string): Promise<PlayerSummaryDto> {
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
				"rank"
			FROM ranked_stats
			WHERE "userId" = $2;
		`;

		const rows: Array<{
			userId: string;
			username: string;
			points: number | string;
			wins: number | string;
			losses: number | string;
			rank: number | string;
		}> = await dataSource.query(sql, [formatId, userId]);

		if (!rows || rows.length === 0) {
			return {
				rank: null,
				points: 0,
				matches: 0,
				wins: 0,
				losses: 0,
				winRate: 0,
			};
		}

		const row = rows[0];
		const wins = Number(row.wins);
		const losses = Number(row.losses);
		const matches = wins + losses;
		const points = Number(row.points);
		const rank = Number(row.rank);

		return {
			rank,
			points,
			matches,
			wins,
			losses,
			winRate: calculateWinRate(wins, matches),
		};
	}

	/**
	 * 查询玩家指定半年赛季天梯摘要
	 * 业务意图：利用 startMonth 与 endMonth 限定赛季范围，排名规则与既有半年榜单严格保持一致。
	 */
	async getPlayerSeasonSummary(
		userId: string,
		formatId: string,
		season: BeijingHalfYearSeason,
	): Promise<PlayerSummaryDto> {
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
				"rank"
			FROM ranked_stats
			WHERE "userId" = $4;
		`;

		const rows: Array<{
			userId: string;
			username: string;
			points: number | string;
			wins: number | string;
			losses: number | string;
			rank: number | string;
		}> = await dataSource.query(sql, [formatId, season.startMonth, season.endMonth, userId]);

		if (!rows || rows.length === 0) {
			return {
				rank: null,
				points: 0,
				matches: 0,
				wins: 0,
				losses: 0,
				winRate: 0,
			};
		}

		const row = rows[0];
		const wins = Number(row.wins);
		const losses = Number(row.losses);
		const matches = wins + losses;
		const points = Number(row.points);
		const rank = Number(row.rank);

		return {
			rank,
			points,
			matches,
			wins,
			losses,
			winRate: calculateWinRate(wins, matches),
		};
	}

	/**
	 * 查询玩家卡组使用与 G1 先后手统计
	 * 业务意图：
	 * 1. 过滤 anulled 与 soft-deleted 脏数据；
	 * 2. 关联 G1 小局（duel_index = 1）取得先后手，杜绝 G2/G3 先后手污染；
	 * 3. 缺失快照归为 unknown/未知，与分类为 OTHERS/其他 明确隔离。
	 */
	async getPlayerDeckStats(
		userId: string,
		formatId: string,
		season?: BeijingHalfYearSeason,
	): Promise<PlayerDeckStatDto[]> {
		const params: any[] = [userId, formatId];
		let seasonClause = "";

		if (season) {
			params.push(season.startMonth, season.endMonth);
			seasonClause = `AND m.season BETWEEN $${params.length - 1} AND $${params.length}`;
		}

		const sql = `
			SELECT
				COALESCE(md.deck_type_code, 'unknown') AS "deckTypeCode",
				CASE
					WHEN md.match_id IS NULL THEN '未知'
					WHEN dt.name_zh IS NOT NULL THEN dt.name_zh
					WHEN md.deck_type_code = 'OTHERS' THEN '其他'
					ELSE md.deck_type_code
				END AS "deckTypeName",
				COUNT(m.id)::int AS "matches",
				SUM(CASE WHEN m.winner THEN 1 ELSE 0 END)::int AS "wins",
				SUM(CASE WHEN NOT m.winner THEN 1 ELSE 0 END)::int AS "losses",
				SUM(CASE WHEN d.is_first = true THEN 1 ELSE 0 END)::int AS "firstCount",
				SUM(CASE WHEN d.is_first = false THEN 1 ELSE 0 END)::int AS "secondCount"
			FROM matches m
			LEFT JOIN match_decks md ON md.match_id = m.id AND md.format_id = m.format_id
			LEFT JOIN deck_types dt ON dt.format_id = md.format_id AND dt.code = md.deck_type_code
			LEFT JOIN duels d ON d.match_id = m.id AND d.duel_index = 1 AND d.deleted_at IS NULL
			WHERE m.user_id = $1
			  AND m.format_id = $2
			  AND m.anulled = false
			  AND m.deleted_at IS NULL
			  ${seasonClause}
			GROUP BY
				COALESCE(md.deck_type_code, 'unknown'),
				CASE
					WHEN md.match_id IS NULL THEN '未知'
					WHEN dt.name_zh IS NOT NULL THEN dt.name_zh
					WHEN md.deck_type_code = 'OTHERS' THEN '其他'
					ELSE md.deck_type_code
				END
			ORDER BY "matches" DESC, "deckTypeCode" ASC;
		`;

		const rows: Array<{
			deckTypeCode: string;
			deckTypeName: string;
			matches: number | string;
			wins: number | string;
			losses: number | string;
			firstCount: number | string;
			secondCount: number | string;
		}> = await dataSource.query(sql, params);

		return rows.map((r) => {
			const matches = Number(r.matches);
			const wins = Number(r.wins);
			const losses = Number(r.losses);
			const firstCount = Number(r.firstCount);
			const secondCount = Number(r.secondCount);

			return {
				deckTypeCode: r.deckTypeCode,
				deckTypeName: r.deckTypeName,
				matches,
				wins,
				losses,
				winRate: calculateWinRate(wins, matches),
				firstCount,
				secondCount,
				firstRate: calculateG1FirstRate(firstCount, secondCount),
			};
		});
	}

	/**
	 * 获取全时期最近最多 20 场比赛增减，供积分走势图倒推
	 */
	async getRatingTrendMatches(
		userId: string,
		formatId: string,
	): Promise<Array<{ matchId: string; date: Date; pointsChange: number }>> {
		const sql = `
			SELECT
				m.id AS "matchId",
				m.date AS "date",
				m.points::int AS "pointsChange"
			FROM matches m
			WHERE m.user_id = $1
			  AND m.format_id = $2
			  AND m.anulled = false
			  AND m.deleted_at IS NULL
			ORDER BY m.date DESC, m.id DESC
			LIMIT 20;
		`;

		const rows: Array<{
			matchId: string;
			date: Date;
			pointsChange: number | string;
		}> = await dataSource.query(sql, [userId, formatId]);

		return rows.map((r) => ({
			matchId: r.matchId,
			date: r.date,
			pointsChange: Number(r.pointsChange),
		}));
	}

	/**
	 * 查询玩家全时期有效 Match 总数
	 */
	async getMatchHistoryCount(userId: string, formatId: string): Promise<number> {
		const sql = `
			SELECT COUNT(*)::int AS count
			FROM matches m
			WHERE m.user_id = $1
			  AND m.format_id = $2
			  AND m.anulled = false
			  AND m.deleted_at IS NULL;
		`;

		const rows: Array<{ count: number | string }> = await dataSource.query(sql, [userId, formatId]);

		return rows.length > 0 ? Number(rows[0].count) : 0;
	}

	/**
	 * 分页查询目标玩家对战记录，并倒推计算双方结算后总积分
	 * 业务意图：
	 * 1. 采用窗口函数 SUM(...) OVER 累加当前场次之后发生的所有积分增减，由当前总积分扣除该累加值计算结算后总积分；
	 * 2. 对手积分亦根据对手自身当前总积分及其后续比赛增减独立计算，保持双方积分口径准确；
	 * 3. 严格关联同 game_id 与 format_id 的有效对手记录，避免跨赛制串门。
	 */
	async getMatchHistoryPage(
		userId: string,
		formatId: string,
		offset: number,
		limit: number,
	): Promise<RawPlayerMatchRow[]> {
		const sql = `
			WITH player_current_points AS (
				SELECT COALESCE(SUM(ps.points), 0)::int AS "currPoints"
				FROM player_stats ps
				WHERE ps.user_id = $1 AND ps.format_id = $2
			),
			user_matches AS (
				SELECT
					m.id AS "matchId",
					m.game_id AS "gameId",
					m.date AS "date",
					m.winner AS "winner",
					m.player_score AS "playerScore",
					m.opponent_score AS "opponentScore",
					m.points::int AS "playerPointsChange",
					m.season::int AS "season",
					(
						(SELECT "currPoints" FROM player_current_points) -
						COALESCE(SUM(m.points) OVER (
							ORDER BY m.date DESC, m.id DESC
							ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
						), 0)
					)::int AS "playerSettledPoints"
				FROM matches m
				WHERE m.user_id = $1
				  AND m.format_id = $2
				  AND m.anulled = false
				  AND m.deleted_at IS NULL
			),
			paged_matches AS (
				SELECT *
				FROM user_matches
				ORDER BY "date" DESC, "matchId" DESC
				LIMIT $3 OFFSET $4
			)
			SELECT
				pm."matchId",
				pm."gameId",
				pm."date",
				pm."winner",
				pm."playerScore",
				pm."opponentScore",
				pm."playerPointsChange",
				pm."season",
				pm."playerSettledPoints",
				opp.id AS "opponentMatchId",
				opp.user_id AS "opponentUserId",
				COALESCE(opp_u.username, '未知对手') AS "opponentUsername",
				opp.player_score AS "opponentPlayerScore",
				opp.points::int AS "opponentPointsChange",
				opp_u.id IS NOT NULL AS "opponentCanJump",
				(
					CASE WHEN opp.user_id IS NOT NULL THEN (
						COALESCE((
							SELECT SUM(ps.points)::int
							FROM player_stats ps
							WHERE ps.user_id = opp.user_id AND ps.format_id = $2
						), 0) -
						COALESCE((
							SELECT SUM(m_after.points)::int
							FROM matches m_after
							WHERE m_after.user_id = opp.user_id
							  AND m_after.format_id = $2
							  AND m_after.anulled = false
							  AND m_after.deleted_at IS NULL
							  AND (m_after.date > opp.date OR (m_after.date = opp.date AND m_after.id > opp.id))
						), 0)
					) ELSE NULL END
				)::int AS "opponentSettledPoints"
			FROM paged_matches pm
			LEFT JOIN matches opp ON opp.game_id = pm."gameId"
				AND opp.format_id = $2
				AND opp.user_id != $1
				AND opp.anulled = false
				AND opp.deleted_at IS NULL
			LEFT JOIN users opp_u ON opp_u.id = opp.user_id
			ORDER BY pm."date" DESC, pm."matchId" DESC;
		`;

		const rows: Array<{
			matchId: string;
			gameId: string;
			date: Date;
			winner: boolean;
			playerScore: number | string;
			opponentScore: number | string;
			playerPointsChange: number | string;
			season: number | string;
			playerSettledPoints: number | string;
			opponentUserId: string | null;
			opponentMatchId: string | null;
			opponentUsername: string | null;
			opponentPlayerScore: number | string | null;
			opponentPointsChange: number | string | null;
			opponentSettledPoints: number | string | null;
			opponentCanJump: boolean;
		}> = await dataSource.query(sql, [userId, formatId, limit, offset]);

		return rows.map((r) => ({
			matchId: r.matchId,
			gameId: r.gameId,
			date: r.date,
			winner: Boolean(r.winner),
			playerScore: Number(r.playerScore),
			opponentScore: Number(r.opponentScore),
			playerPointsChange: Number(r.playerPointsChange),
			season: Number(r.season),
			playerSettledPoints: Number(r.playerSettledPoints),
			opponentUserId: r.opponentUserId,
			opponentMatchId: r.opponentMatchId,
			opponentUsername: r.opponentUsername,
			opponentPlayerScore: r.opponentPlayerScore !== null ? Number(r.opponentPlayerScore) : null,
			opponentPointsChange: r.opponentPointsChange !== null ? Number(r.opponentPointsChange) : null,
			opponentSettledPoints:
				r.opponentSettledPoints !== null ? Number(r.opponentSettledPoints) : null,
			opponentCanJump: Boolean(r.opponentCanJump),
		}));
	}

	/**
	 * 批量查询当页比赛的双方卡组快照元数据
	 * 业务边界：仅查询元数据与 Side 完整性标记，严禁读取 main_cards 等卡片数组以减少网络负载。
	 */
	async getMatchDecksBatch(matchIds: string[], formatId: string): Promise<RawPlayerMatchDeckRow[]> {
		if (matchIds.length === 0) {
			return [];
		}

		const sql = `
			SELECT
				md.match_id AS "matchId",
				md.deck_type_code AS "deckTypeCode",
				COALESCE(dt.name_zh, CASE WHEN md.deck_type_code = 'OTHERS' THEN '其他' ELSE md.deck_type_code END) AS "deckTypeName",
				(md.match_id IS NOT NULL) AS "hasSnapshot",
				(md.side_cards IS NULL) AS "isPartial"
			FROM match_decks md
			LEFT JOIN deck_types dt ON dt.format_id = md.format_id AND dt.code = md.deck_type_code
			WHERE md.match_id = ANY($1) AND md.format_id = $2;
		`;

		const rows: Array<{
			matchId: string;
			deckTypeCode: string | null;
			deckTypeName: string | null;
			hasSnapshot: boolean;
			isPartial: boolean;
		}> = await dataSource.query(sql, [matchIds, formatId]);

		return rows.map((r) => ({
			matchId: r.matchId,
			isOpponent: false,
			deckTypeCode: r.deckTypeCode,
			deckTypeName: r.deckTypeName,
			hasSnapshot: Boolean(r.hasSnapshot),
			isPartial: Boolean(r.isPartial),
		}));
	}

	/**
	 * 批量查询当页比赛的小局决斗录像与 G1 先后手
	 * 业务边界：严禁读取 replay_data 二进制，防止大流量打爆网络。
	 */
	async getMatchDuelsBatch(matchIds: string[]): Promise<RawPlayerMatchDuelRow[]> {
		if (matchIds.length === 0) {
			return [];
		}

		const sql = `
			SELECT
				d.match_id AS "matchId",
				d.duel_index::int AS "duelIndex",
				d.replay_id AS "replayId",
				d.is_first AS "isFirst"
			FROM duels d
			WHERE d.match_id = ANY($1) AND d.deleted_at IS NULL
			ORDER BY d.match_id, d.duel_index ASC;
		`;

		const rows: Array<{
			matchId: string;
			duelIndex: number | string;
			replayId: string;
			isFirst: boolean | null;
		}> = await dataSource.query(sql, [matchIds]);

		return rows.map((r) => ({
			matchId: r.matchId,
			duelIndex: Number(r.duelIndex),
			replayId: r.replayId,
			isFirst: r.isFirst !== null ? Boolean(r.isFirst) : null,
		}));
	}
}
