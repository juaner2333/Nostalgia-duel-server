import { BeijingHalfYearSeason } from "src/utils/calculateBeijingSeason";
import { PlayerDeckStatDto, PlayerSummaryDto } from "./PlayerDetailDto";

/**
 * 原始玩家对战记录行（用于仓库层向应用层提供分页及对手关联）
 */
export interface RawPlayerMatchRow {
	/** 比赛 Match ID */
	matchId: string;
	/** 决斗房间 UUID */
	gameId: string;
	/** 比赛结算时间 */
	date: Date;
	/** 当前玩家是否获胜 */
	winner: boolean;
	/** 当前玩家小局得分 */
	playerScore: number;
	/** 对手小局得分 */
	opponentScore: number;
	/** 当前玩家本场积分变化 */
	playerPointsChange: number;
	/** 比赛所属年月赛季数字（例如 202609） */
	season: number;
	/** 目标玩家本场结算后累计总积分（倒推计算得出） */
	playerSettledPoints: number;

	/** 对手用户 ID（无法确认时为 null） */
	opponentUserId: string | null;
	/** 对手比赛 Match ID（无法确认时为 null） */
	opponentMatchId: string | null;
	/** 对手玩家昵称 */
	opponentUsername: string | null;
	/** 对手小局得分 */
	opponentPlayerScore: number | null;
	/** 对手本场积分变化 */
	opponentPointsChange: number | null;
	/** 对手本场结算后累计总积分（倒推计算得出） */
	opponentSettledPoints: number | null;
	/** 对手是否为有效已注册账号 */
	opponentCanJump: boolean;
}

/**
 * 原始对战卡组快照信息行
 */
export interface RawPlayerMatchDeckRow {
	/** 关联的 Match ID */
	matchId: string;
	/** 是否属于对手视角卡组（true: 对手, false: 目标玩家） */
	isOpponent: boolean;
	/** 卡组类型代码 */
	deckTypeCode: string | null;
	/** 卡组类型中文名称 */
	deckTypeName: string | null;
	/** 是否存在卡组快照 */
	hasSnapshot: boolean;
	/** 是否仅部分卡组（缺失 Side 卡组） */
	isPartial: boolean;
}

/**
 * 原始小局决斗信息行
 */
export interface RawPlayerMatchDuelRow {
	/** 关联的 Match ID */
	matchId: string;
	/** 小局序号（1 为 G1，2 为 G2，3 为 G3） */
	duelIndex: number;
	/** 录像记录 UUID */
	replayId: string;
	/** 当前玩家在该小局是否为先手（null 表示未知） */
	isFirst: boolean | null;
}

/**
 * 玩家详情数据查询仓储端口
 */
export interface PlayerDetailRepository {
	/**
	 * 查询玩家在指定格式的全时期战绩摘要
	 */
	getPlayerOverallSummary(userId: string, formatId: string): Promise<PlayerSummaryDto>;

	/**
	 * 查询玩家在指定格式及半年赛季的战绩摘要
	 */
	getPlayerSeasonSummary(
		userId: string,
		formatId: string,
		season: BeijingHalfYearSeason,
	): Promise<PlayerSummaryDto>;

	/**
	 * 查询玩家在指定格式（及可选半年赛季）的卡组使用与 G1 先后手统计
	 */
	getPlayerDeckStats(
		userId: string,
		formatId: string,
		season?: BeijingHalfYearSeason,
	): Promise<PlayerDeckStatDto[]>;

	/**
	 * 获取全时期最近最多 20 场比赛的积分增减（按时间降序最新在前），用于走势曲线计算
	 */
	getRatingTrendMatches(
		userId: string,
		formatId: string,
	): Promise<Array<{ matchId: string; date: Date; pointsChange: number }>>;

	/**
	 * 查询当前玩家在当前格式下的全时期有效 Match 总数
	 */
	getMatchHistoryCount(userId: string, formatId: string): Promise<number>;

	/**
	 * 分页获取全时期有效 Match 列表（按结算时间降序及 ID 降序排列）
	 */
	getMatchHistoryPage(
		userId: string,
		formatId: string,
		offset: number,
		limit: number,
	): Promise<RawPlayerMatchRow[]>;

	/**
	 * 批量查询当页比赛的卡组快照元数据
	 */
	getMatchDecksBatch(matchIds: string[], formatId: string): Promise<RawPlayerMatchDeckRow[]>;

	/**
	 * 批量查询当页比赛的小局决斗录像及先后手
	 */
	getMatchDuelsBatch(matchIds: string[]): Promise<RawPlayerMatchDuelRow[]>;
}
