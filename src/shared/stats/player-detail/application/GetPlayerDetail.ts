import { Logger } from "src/shared/logger/domain/Logger";
import { UserProfileRepository } from "src/shared/user-profile/domain/UserProfileRepository";
import { parseHalfYearSeason } from "src/utils/calculateBeijingSeason";
import { PlayerDetailAuthRateLimiter } from "../domain/PlayerDetailAuthRateLimiter";
import {
	PlayerDeckStatDto,
	PlayerDetailQuery,
	PlayerDetailResult,
	PlayerMatchDeckInfoDto,
	PlayerMatchHistoryItemDto,
	PlayerSummaryDto,
} from "../domain/PlayerDetailDto";
import {
	PlayerDetailRepository,
	RawPlayerMatchDeckRow,
	RawPlayerMatchDuelRow,
} from "../domain/PlayerDetailRepository";
import {
	calculateRatingTrend,
	PLAYER_DETAIL_PAGE_SIZE,
	validatePlayerDetailQuery,
} from "../domain/PlayerDetailRules";

/**
 * 密码验证频率超限异常（对应 HTTP 429）
 */
export class PlayerDetailRateLimitExceededError extends Error {
	constructor(message = "密码验证尝试过于频繁，请稍后再试") {
		super(message);
		this.name = "PlayerDetailRateLimitExceededError";
	}
}

/**
 * 获取玩家战绩详情用例
 * 业务意图：
 * 1. 严格实现公开模式与本人验证模式的安全隔离：无凭据或凭据错误仅展示全时期最近 20 条，验证成功后放开全时期分页；
 * 2. 战绩统计范围（总榜或半年赛季）仅影响战绩摘要与卡组统计，对战历史记录与 20 场积分曲线统一使用全时期数据；
 * 3. 密码只在当前请求正文中短暂存在，严禁进入返回值、日志或任何持久化存储；
 * 4. 目标玩家账号不存在时返回业务未找到状态，半年无比赛时返回半年空战绩，全时期数据不受影响。
 */
export class GetPlayerDetail {
	constructor(
		private readonly playerDetailRepository: PlayerDetailRepository,
		private readonly userProfileRepository: UserProfileRepository,
		private readonly authRateLimiter: PlayerDetailAuthRateLimiter,
		private readonly logger: Logger,
	) {}

	async execute(query: PlayerDetailQuery, sourceIp?: string): Promise<PlayerDetailResult> {
		// 1. 输入与范围合法性校验
		const validated = validatePlayerDetailQuery(query);

		// 2. 账号精确查找
		const user = await this.userProfileRepository.findByUsername(validated.player);
		if (!user) {
			return {
				found: false,
				player: validated.player,
				format: validated.format,
				scope: validated.scope,
				season: validated.season,
				isVerified: false,
				authFailed: false,
				overallSummary: null,
				overallDeckStats: [],
				seasonSummary: null,
				seasonDeckStats: null,
				ratingTrend: [],
				matches: [],
				pagination: {
					page: 1,
					pageSize: PLAYER_DETAIL_PAGE_SIZE,
					total: 0,
				},
			};
		}

		// 3. 权限与密码验证分支
		const hasPassword = Boolean(validated.password && validated.password.trim() !== "");
		let isVerified = false;
		let authFailed = false;

		if (hasPassword) {
			const clientIp = sourceIp || "unknown";
			const normalizedUsername = user.username.trim().toLowerCase();

			// 检查失败预算防暴力破解：60秒内超过5次直接触发 429
			const limited = await this.authRateLimiter.isLimited(clientIp, normalizedUsername);
			if (limited) {
				this.logger.warn(`Player detail auth rate limit exceeded for ${normalizedUsername}`);
				throw new PlayerDetailRateLimitExceededError();
			}

			// 复用既有 bcrypt 校验
			const valid = await user.isValidPassword(validated.password!);
			if (valid) {
				isVerified = true;
				authFailed = false;
				await this.authRateLimiter.reset(clientIp, normalizedUsername);
			} else {
				isVerified = false;
				authFailed = true;
				await this.authRateLimiter.recordFailure(clientIp, normalizedUsername);
			}
		}

		// 4. 对战历史分页边界控制
		let page = 1;
		let offset = 0;
		const limit = PLAYER_DETAIL_PAGE_SIZE;
		let totalCount = 0;

		if (isVerified) {
			page = validated.page;
			offset = (page - 1) * limit;
			totalCount = await this.playerDetailRepository.getMatchHistoryCount(
				user.id,
				validated.format,
			);
		} else {
			// 未验证公开模式：严格锁定第 1 页与 20 条上限，禁止以任何参数绕过
			page = 1;
			offset = 0;
		}

		// 5. 战绩摘要与卡组统计查询
		const overallSummary = await this.playerDetailRepository.getPlayerOverallSummary(
			user.id,
			validated.format,
		);
		const overallDeckStats = await this.playerDetailRepository.getPlayerDeckStats(
			user.id,
			validated.format,
		);

		let seasonSummary: PlayerSummaryDto | null = null;
		let seasonDeckStats: PlayerDeckStatDto[] | null = null;

		if (validated.scope === "season" && validated.season) {
			const halfYear = parseHalfYearSeason(validated.season);
			seasonSummary = await this.playerDetailRepository.getPlayerSeasonSummary(
				user.id,
				validated.format,
				halfYear,
			);
			seasonDeckStats = await this.playerDetailRepository.getPlayerDeckStats(
				user.id,
				validated.format,
				halfYear,
			);
		}

		// 6. 全时期最近 20 场积分曲线计算
		const trendMatches = await this.playerDetailRepository.getRatingTrendMatches(
			user.id,
			validated.format,
		);
		const ratingTrend = calculateRatingTrend(overallSummary.points, trendMatches);

		// 7. 对战记录分页与双方元数据批量关联
		const rawMatches = await this.playerDetailRepository.getMatchHistoryPage(
			user.id,
			validated.format,
			offset,
			limit,
		);

		if (!isVerified) {
			// 公开模式下对外展示的总数仅代表可见条数（最多 20），不泄露真实总场次
			totalCount = rawMatches.length;
		}

		const allMatchIds: string[] = [];
		for (const m of rawMatches) {
			allMatchIds.push(m.matchId);
			if (m.opponentMatchId) {
				allMatchIds.push(m.opponentMatchId);
			}
		}

		const matchDecks = await this.playerDetailRepository.getMatchDecksBatch(
			allMatchIds,
			validated.format,
		);
		const deckMap = new Map<string, RawPlayerMatchDeckRow>();
		for (const d of matchDecks) {
			deckMap.set(d.matchId, d);
		}

		const matchDuels = await this.playerDetailRepository.getMatchDuelsBatch(
			rawMatches.map((m) => m.matchId),
		);
		const duelMap = new Map<string, RawPlayerMatchDuelRow[]>();
		for (const d of matchDuels) {
			let list = duelMap.get(d.matchId);
			if (!list) {
				list = [];
				duelMap.set(d.matchId, list);
			}
			list.push(d);
		}

		const matches: PlayerMatchHistoryItemDto[] = rawMatches.map((m) => {
			const pDeck = deckMap.get(m.matchId);
			const oDeck = m.opponentMatchId ? deckMap.get(m.opponentMatchId) : null;
			const duels = duelMap.get(m.matchId) || [];
			const g1Duel = duels.find((d) => d.duelIndex === 1);

			const playerDeck: PlayerMatchDeckInfoDto = {
				hasSnapshot: pDeck?.hasSnapshot || false,
				isPartial: pDeck?.isPartial || false,
				downloadUrl: pDeck?.hasSnapshot
					? `/api/ladder/${validated.format}/matches/${m.matchId}/deck`
					: null,
			};

			const opponentDeck: PlayerMatchDeckInfoDto = {
				hasSnapshot: oDeck?.hasSnapshot || false,
				isPartial: oDeck?.isPartial || false,
				downloadUrl:
					oDeck?.hasSnapshot && m.opponentMatchId
						? `/api/ladder/${validated.format}/matches/${m.opponentMatchId}/deck`
						: null,
			};

			return {
				matchId: m.matchId,
				gameId: m.gameId,
				date: typeof m.date === "string" ? m.date : m.date.toISOString(),
				opponentUserId: m.opponentUserId,
				opponentUsername: m.opponentUsername || "未知对手",
				opponentCanJump: m.opponentCanJump,
				winner: m.winner,
				playerScore: m.playerScore,
				opponentScore: m.opponentScore,
				g1First: g1Duel ? g1Duel.isFirst : null,
				playerDeckTypeCode: pDeck?.deckTypeCode || "unknown",
				playerDeckTypeName: pDeck?.deckTypeName || "未知",
				opponentDeckTypeCode: oDeck?.deckTypeCode || "unknown",
				opponentDeckTypeName: oDeck?.deckTypeName || "未知",
				playerPointsChange: m.playerPointsChange,
				opponentPointsChange: m.opponentPointsChange ?? 0,
				playerSettledPoints: m.playerSettledPoints,
				opponentSettledPoints: m.opponentSettledPoints ?? 0,
				playerDeck,
				opponentDeck,
				duels: duels.map((d) => ({
					duelIndex: d.duelIndex,
					replayId: d.replayId,
					isFirst: d.isFirst,
					downloadUrl: `/api/replays/${validated.format}/${d.replayId}`,
				})),
			};
		});

		return {
			found: true,
			player: user.username,
			format: validated.format,
			scope: validated.scope,
			season: validated.season,
			isVerified,
			authFailed,
			overallSummary,
			overallDeckStats,
			seasonSummary,
			seasonDeckStats,
			ratingTrend,
			matches,
			pagination: {
				page,
				pageSize: limit,
				total: totalCount,
			},
		};
	}
}
