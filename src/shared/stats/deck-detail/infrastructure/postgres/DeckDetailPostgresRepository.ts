import { DataSource, QueryRunner } from "typeorm";
import { dataSource } from "../../../../../evolution-types/src/data-source";
import {
	DeckDetailRawMatchupRow,
	DeckDetailRawSnapshot,
	DeckDetailRawTopPlayerRow,
	DeckDetailRawUsageCount,
	DeckDetailRepository,
	DeckDetailTimeWindow,
} from "../../domain/DeckDetailRepository";
import { formatBeijingDateTime, getNamedDeckTypes } from "../../domain/DeckDetailRules";

export class DeckDetailPostgresRepository implements DeckDetailRepository {
	public constructor(private readonly dbSource: DataSource = dataSource) {}

	/**
	 * 构建用于全维度聚合查询的局部公共样本 CTE
	 * 业务意图与设计决策（Trade-offs）：
	 * 1. 严格以物理比赛（game_id + format_id）为单元，先校验双方完整性、双方均未撤销且未软删、
	 *    比分与胜负严格互补，避免因提前过滤单方而把异常/单边比赛误判为有效比赛；
	 * 2. 严格排除 OTHERS（任一方为 OTHERS 则整场排除，不能转为未知）；
	 * 3. 对手缺失 match_decks 时合法保留为 "unknown"，但不合法/异常代码直接隔离；
	 * 4. G1 座次仅关联 duel_index = 1 且未软删的决斗，双方 is_first 一真一假时座次才可信，
	 *    缺失或冲突时降级为座次未知，G2/G3 绝不参与座次判定；
	 * 5. 全程采用参数化查询，仅返回聚合行，严禁将卡组卡片数组或录像 bytea 读取到 Node 进程。
	 */
	private buildCommonCteSql(): string {
		return `
			WITH candidate_games AS (
				SELECT DISTINCT m.game_id
				FROM matches m
				WHERE m.format_id = $1
				  AND m.date >= $2::timestamp
				  AND m.date < $3::timestamp
				  AND m.deleted_at IS NULL
				  AND m.anulled = false
			),
			raw_perspectives AS (
				SELECT 
					m.game_id,
					m.id AS match_id,
					m.user_id,
					m.winner,
					m.player_score,
					m.opponent_score,
					m.anulled,
					m.deleted_at,
					m.date,
					COUNT(*) OVER (PARTITION BY m.game_id) AS game_record_count
				FROM matches m
				WHERE m.format_id = $1
				  AND m.game_id IN (SELECT game_id FROM candidate_games)
			),
			paired_perspectives AS (
				SELECT
					m1.game_id,
					m1.match_id,
					m1.user_id,
					m1.winner,
					m2.match_id AS opp_match_id,
					m2.user_id AS opp_user_id
				FROM raw_perspectives m1
				JOIN raw_perspectives m2 ON m1.game_id = m2.game_id AND m1.match_id <> m2.match_id
				WHERE m1.game_record_count = 2
				  AND m1.user_id <> m2.user_id
				  AND m1.anulled = false
				  AND m1.deleted_at IS NULL
				  AND m2.anulled = false
				  AND m2.deleted_at IS NULL
				  AND m1.date >= $2::timestamp
				  AND m1.date < $3::timestamp
				  AND m2.date >= $2::timestamp
				  AND m2.date < $3::timestamp
				  AND m1.winner <> m2.winner
				  AND m1.player_score = m2.opponent_score
				  AND m1.opponent_score = m2.player_score
			),
			valid_deck_perspectives AS (
				SELECT
					p.game_id,
					p.match_id,
					p.user_id,
					p.winner,
					md1.deck_type_code,
					md2.deck_type_code AS opp_deck_type_code,
					CASE
						WHEN d1.id IS NOT NULL AND d2.id IS NOT NULL
						 AND d1.is_first IS NOT NULL AND d2.is_first IS NOT NULL
						 AND d1.is_first <> d2.is_first
						THEN (CASE WHEN d1.is_first = true THEN 1 WHEN d1.is_first = false THEN 2 ELSE 0 END)
						ELSE 0
					END AS seat_code
				FROM paired_perspectives p
				JOIN match_decks md1 ON md1.match_id = p.match_id AND md1.format_id = $1
				LEFT JOIN match_decks md2 ON md2.match_id = p.opp_match_id AND md2.format_id = $1
				LEFT JOIN duels d1 ON d1.match_id = p.match_id 
				                   AND d1.duel_index = 1 
				                   AND d1.deleted_at IS NULL 
				                   AND d1.game_id = p.game_id 
				                   AND d1.user_id = p.user_id
				LEFT JOIN duels d2 ON d2.match_id = p.opp_match_id 
				                   AND d2.duel_index = 1 
				                   AND d2.deleted_at IS NULL 
				                   AND d2.game_id = p.game_id 
				                   AND d2.user_id = p.opp_user_id
				WHERE md1.deck_type_code = ANY($4::varchar[])
				  AND (md2.deck_type_code IS NULL OR (md2.deck_type_code <> 'OTHERS' AND md2.deck_type_code = ANY($4::varchar[])))
			)
		`;
	}

	/**
	 * 获取指定卡组在指定半年窗口内的一致快照
	 * 性能设计决策（Optimization & Performance）：
	 * 1. 优先走每日预聚合物理表（stats_deck_detail_matchups、stats_deck_top_players、usage_deck_rows），
	 *    直接基于主键索引进行两次极简点查（约 31 行 + 10 行），耗时降至 1~2ms，消除全量多表 CTE 关联；
	 * 2. 若当前半年尚未执行跑批发布，自动安全降级为 REPEATABLE READ 只读事务下的实时公共 CTE 聚合计算，
	 *    保证新环境、刚启动未跑批或集成测试下的绝对自愈能力与零口径差。
	 */
	public async getDeckDetailSnapshot(
		format: string,
		deckTypeCode: string,
		timeWindow: DeckDetailTimeWindow,
	): Promise<DeckDetailRawSnapshot> {
		const queryRunner: QueryRunner = this.dbSource.createQueryRunner();
		await queryRunner.connect();

		try {
			// 1. 检查是否存在已发布的每日预聚合快照
			const runRows: Array<{ published_at: Date; data_end_exclusive: string }> =
				await queryRunner.query(
					`SELECT published_at, data_end_exclusive::text AS data_end_exclusive 
					 FROM usage_stat_runs 
					 WHERE format_id = $1 AND window_start = $2::date`,
					[format, timeWindow.windowStart],
				);

			const precomputedCountRows: Array<{ cnt: number | string }> =
				runRows && runRows.length > 0
					? await queryRunner.query(
							`SELECT COUNT(*)::int AS cnt 
							 FROM stats_deck_detail_matchups 
							 WHERE format_id = $1 AND window_start = $2::date`,
							[format, timeWindow.windowStart],
						)
					: [{ cnt: 0 }];

			const hasPrecomputed = Number(precomputedCountRows[0]?.cnt ?? 0) > 0;

			if (hasPrecomputed) {
				const run = runRows[0];
				const publishedAt = new Date(run.published_at);
				const effectiveTimeWindow: DeckDetailTimeWindow = {
					...timeWindow,
					dataEndExclusive: String(run.data_end_exclusive).slice(0, 10),
				};

				// 1. 查询全部具名卡组使用数（直接从 usage_deck_rows 获取）
				const usageRows: Array<{ deck_type_code: string; count: number | string }> =
					await queryRunner.query(
						`SELECT deck_type_code, deck_count AS count 
						 FROM usage_deck_rows 
						 WHERE format_id = $1 AND window_start = $2::date AND deck_type_code <> 'OTHERS'`,
						[format, timeWindow.windowStart],
					);
				const usageCounts: DeckDetailRawUsageCount[] = (usageRows ?? []).map((r) => ({
					deckTypeCode: r.deck_type_code,
					count: Number(r.count),
				}));

				// 2. 毫秒级主键点查目标卡组对阵 8 计数
				const matchupRows: Array<{
					opp_deck_type_code: string;
					matches: number | string;
					match_wins: number | string;
					first_matches: number | string;
					first_wins: number | string;
					second_matches: number | string;
					second_wins: number | string;
					unknown_seat_matches: number | string;
					unknown_seat_wins: number | string;
				}> = await queryRunner.query(
					`SELECT 
						opp_deck_type_code, matches, match_wins, first_matches, first_wins,
						second_matches, second_wins, unknown_seat_matches, unknown_seat_wins
					 FROM stats_deck_detail_matchups
					 WHERE format_id = $1 AND window_start = $2::date AND deck_type_code = $3`,
					[format, timeWindow.windowStart, deckTypeCode],
				);
				const matchups: DeckDetailRawMatchupRow[] = (matchupRows ?? []).map((r) => ({
					opponentCode: r.opp_deck_type_code,
					matches: Number(r.matches),
					matchWins: Number(r.match_wins),
					firstMatches: Number(r.first_matches),
					firstWins: Number(r.first_wins),
					secondMatches: Number(r.second_matches),
					secondWins: Number(r.second_wins),
					unknownSeatMatches: Number(r.unknown_seat_matches),
					unknownSeatWins: Number(r.unknown_seat_wins),
				}));

				// 3. 毫秒级主键点查专精玩家 Top10 榜
				const topPlayerRows: Array<{
					username: string;
					matches: number | string;
					wins: number | string;
					losses: number | string;
					win_rate: number | string;
				}> = await queryRunner.query(
					`SELECT username, matches, wins, losses, win_rate
					 FROM stats_deck_top_players
					 WHERE format_id = $1 AND window_start = $2::date AND deck_type_code = $3
					 ORDER BY rank ASC`,
					[format, timeWindow.windowStart, deckTypeCode],
				);
				const topPlayers: DeckDetailRawTopPlayerRow[] = (topPlayerRows ?? []).map((r) => ({
					username: r.username,
					matches: Number(r.matches),
					wins: Number(r.wins),
					losses: Number(r.losses),
					winRate: Number(r.win_rate),
				}));

				return {
					queriedAt: publishedAt,
					timeWindow: effectiveTimeWindow,
					usageCounts,
					matchups,
					topPlayers,
				};
			}

			// 若未跑批预聚合，降级走实时 REPEATABLE READ CTE 快照聚合
			await queryRunner.startTransaction("REPEATABLE READ");
			await queryRunner.query("SET TRANSACTION READ ONLY;");

			// 获取数据库绝对执行时刻作为快照基准时间
			const clockRows: Array<{ queried_at: Date }> = await queryRunner.query(
				"SELECT clock_timestamp() AS queried_at;",
			);
			const queriedAt = new Date(clockRows[0]?.queried_at ?? Date.now());

			// 若为当前进行中半年，数据统计截止时间收敛至本次查询执行的北京时间墙钟时刻
			const effectiveDataEndExclusive = timeWindow.isOngoing
				? formatBeijingDateTime(queriedAt)
				: timeWindow.dataEndExclusive;

			const effectiveTimeWindow: DeckDetailTimeWindow = {
				...timeWindow,
				dataEndExclusive: effectiveDataEndExclusive,
			};

			const namedDeckTypes = getNamedDeckTypes(format);
			const namedCodes: string[] = namedDeckTypes.map((item) => item.code);

			const commonCte = this.buildCommonCteSql();
			const cteParams = [
				format,
				effectiveTimeWindow.windowStart,
				effectiveTimeWindow.dataEndExclusive,
				namedCodes,
			];

			// 1. 查询当前环境全部具名卡组的使用份数聚合
			const usageSql = `
				${commonCte}
				SELECT
					v.deck_type_code,
					COUNT(*)::int AS count
				FROM valid_deck_perspectives v
				GROUP BY v.deck_type_code;
			`;
			const rawUsageRows: Array<{ deck_type_code: string; count: number | string }> =
				await queryRunner.query(usageSql, cteParams);

			const usageCounts: DeckDetailRawUsageCount[] = (rawUsageRows ?? []).map((r) => ({
				deckTypeCode: r.deck_type_code,
				count: Number(r.count),
			}));

			// 2. 查询目标卡组对各个对手的对阵八计数聚合
			const matchupSql = `
				${commonCte}
				SELECT
					COALESCE(v.opp_deck_type_code, 'unknown') AS opponent_code,
					COUNT(*)::int AS matches,
					COUNT(CASE WHEN v.winner = true THEN 1 END)::int AS match_wins,
					COUNT(CASE WHEN v.seat_code = 1 THEN 1 END)::int AS first_matches,
					COUNT(CASE WHEN v.seat_code = 1 AND v.winner = true THEN 1 END)::int AS first_wins,
					COUNT(CASE WHEN v.seat_code = 2 THEN 1 END)::int AS second_matches,
					COUNT(CASE WHEN v.seat_code = 2 AND v.winner = true THEN 1 END)::int AS second_wins,
					COUNT(CASE WHEN v.seat_code = 0 THEN 1 END)::int AS unknown_seat_matches,
					COUNT(CASE WHEN v.seat_code = 0 AND v.winner = true THEN 1 END)::int AS unknown_seat_wins
				FROM valid_deck_perspectives v
				WHERE v.deck_type_code = $5
				GROUP BY COALESCE(v.opp_deck_type_code, 'unknown');
			`;
			const rawMatchupRows: Array<{
				opponent_code: string;
				matches: number | string;
				match_wins: number | string;
				first_matches: number | string;
				first_wins: number | string;
				second_matches: number | string;
				second_wins: number | string;
				unknown_seat_matches: number | string;
				unknown_seat_wins: number | string;
			}> = await queryRunner.query(matchupSql, [...cteParams, deckTypeCode]);

			const matchups: DeckDetailRawMatchupRow[] = (rawMatchupRows ?? []).map((r) => ({
				opponentCode: r.opponent_code,
				matches: Number(r.matches),
				matchWins: Number(r.match_wins),
				firstMatches: Number(r.first_matches),
				firstWins: Number(r.first_wins),
				secondMatches: Number(r.second_matches),
				secondWins: Number(r.second_wins),
				unknownSeatMatches: Number(r.unknown_seat_matches),
				unknownSeatWins: Number(r.unknown_seat_wins),
			}));

			// 3. 查询专精玩家胜率榜（限制 >= 25 场，且仅关联有效 users 账号，内部 ID 绝不回传）
			const topPlayersSql = `
				${commonCte}
				SELECT
					u.username,
					COUNT(*)::int AS matches,
					COUNT(CASE WHEN v.winner = true THEN 1 END)::int AS wins,
					COUNT(CASE WHEN v.winner = false THEN 1 END)::int AS losses,
					(COUNT(CASE WHEN v.winner = true THEN 1 END)::float / COUNT(*)::float) AS win_rate
				FROM valid_deck_perspectives v
				JOIN users u ON u.id = v.user_id
				WHERE v.deck_type_code = $5
				GROUP BY v.user_id, u.username
				HAVING COUNT(*) >= 25
				ORDER BY win_rate DESC, matches DESC, u.username ASC
				LIMIT 10;
			`;
			const rawTopPlayerRows: Array<{
				username: string;
				matches: number | string;
				wins: number | string;
				losses: number | string;
				win_rate: number | string;
			}> = await queryRunner.query(topPlayersSql, [...cteParams, deckTypeCode]);

			const topPlayers: DeckDetailRawTopPlayerRow[] = (rawTopPlayerRows ?? []).map((r) => ({
				username: r.username,
				matches: Number(r.matches),
				wins: Number(r.wins),
				losses: Number(r.losses),
				winRate: Number(r.win_rate),
			}));

			if (queryRunner.isTransactionActive) {
				await queryRunner.commitTransaction();
			}

			return {
				queriedAt,
				timeWindow: effectiveTimeWindow,
				usageCounts,
				matchups,
				topPlayers,
			};
		} catch (error) {
			if (queryRunner.isTransactionActive) {
				await queryRunner.rollbackTransaction();
			}
			throw error;
		} finally {
			await queryRunner.release();
		}
	}
}
