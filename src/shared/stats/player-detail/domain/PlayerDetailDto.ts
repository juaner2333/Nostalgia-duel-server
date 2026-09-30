/**
 * 玩家详情查询请求参数
 */
export interface PlayerDetailQuery {
	/** 目标玩家昵称（精确匹配，去除首尾空白） */
	player: string;
	/** 赛制环境标识（"1103" 或 "1109"） */
	format: string;
	/** 战绩统计范围："overall" 为全时期总战绩，"season" 为半年赛季 */
	scope?: "overall" | "season";
	/** 半年赛季标识（例如 "2026H1"、"2026H2"，仅在 scope="season" 时有效，不传时默认为北京时间当前半年） */
	season?: string;
	/** 可选验证密码（若提供且正确，放开全时期对战历史完整分页） */
	password?: string;
	/** 对战历史请求页码（从 1 开始的正整数，每页固定 20 场） */
	page?: number;
}

/**
 * 玩家天梯战绩摘要
 */
export interface PlayerSummaryDto {
	/** 当前天梯排名（未上榜为 null） */
	rank: number | null;
	/** 当前累计天梯积分（支持零值及负值） */
	points: number;
	/** 总对局场次（胜场数 + 负场数） */
	matches: number;
	/** 获胜场次数 */
	wins: number;
	/** 失败场次数 */
	losses: number;
	/** 胜率（胜场 / 总场次，保留 4 位小数；零场次为 0） */
	winRate: number;
}

/**
 * 玩家使用卡组统计信息（以整场 Match 为统计单位）
 */
export interface PlayerDeckStatDto {
	/** 卡组类型代码（例如 "HERO"、"OTHERS" 或 "unknown"） */
	deckTypeCode: string;
	/** 卡组类型中文名称（例如 "英雄"、"其他" 或 "未知"） */
	deckTypeName: string;
	/** 使用该卡组的已结算 Match 场次数（每场比赛无论小局数仅计 1 次） */
	matches: number;
	/** 整场 Match 获胜场次数 */
	wins: number;
	/** 整场 Match 失败场次数 */
	losses: number;
	/** 胜率（胜场数 / 场次数，保留 4 位小数；零场次为 0） */
	winRate: number;
	/** G1 先手次数（仅统计第 1 小局明确为先手的次数） */
	firstCount: number;
	/** G1 后手次数（仅统计第 1 小局明确为后手的次数） */
	secondCount: number;
	/** G1 先手率（firstCount / (firstCount + secondCount)，保留 4 位小数；若已知先手和后手次数之和为 0 则为 null） */
	firstRate: number | null;
}

/**
 * 积分走势曲线采样点（以当前总积分为终点，向前倒推最多 20 场后按时间正序排列）
 */
export interface PlayerRatingPointDto {
	/** 关联的 Match 标识（若为倒推起点基准点则为 null） */
	matchId: string | null;
	/** 比赛结算时间（ISO 8601 格式字符串；基准点为 null） */
	date: string | null;
	/** 该点对应的累计总积分（支持零值及负值） */
	points: number;
}

/**
 * 单场比赛的卡组快照信息与下载配置
 */
export interface PlayerMatchDeckInfoDto {
	/** 是否存在可信卡组快照 */
	hasSnapshot: boolean;
	/** 是否仅恢复了部分卡组（例如缺失 Side 卡组） */
	isPartial: boolean;
	/** YDK 卡组下载链接路径（无快照时为 null） */
	downloadUrl: string | null;
}

/**
 * 单场 Match 内的小局决斗录像及先后手信息
 */
export interface PlayerMatchDuelInfoDto {
	/** 小局序号（1 为 G1，2 为 G2，3 为 G3） */
	duelIndex: number;
	/** 录像记录唯一标识 UUID */
	replayId: string;
	/** 当前玩家在该小局是否为先手（null 表示记录缺失或未知） */
	isFirst: boolean | null;
	/** YRP 录像下载链接路径 */
	downloadUrl: string;
}

/**
 * 单场 Match 对战记录明细（以目标玩家视角展示）
 */
export interface PlayerMatchHistoryItemDto {
	/** 比赛记录唯一标识 ID */
	matchId: string;
	/** 决斗房间 UUID */
	gameId: string;
	/** 比赛结算时间（ISO 8601 格式字符串） */
	date: string;
	/** 对手用户 ID（无法确认时为 null） */
	opponentUserId: string | null;
	/** 对手玩家昵称 */
	opponentUsername: string;
	/** 对手是否为有效已注册账号（支持点击跳转其详情页） */
	opponentCanJump: boolean;
	/** 目标玩家整场 Match 是否获胜（true: 获胜, false: 失败） */
	winner: boolean;
	/** 目标玩家小局得分 */
	playerScore: number;
	/** 对手小局得分 */
	opponentScore: number;
	/** 目标玩家在 G1 是否为先手（true: 先手, false: 后手, null: 未知） */
	g1First: boolean | null;
	/** 目标玩家本场使用的初始卡组类型代码 */
	playerDeckTypeCode: string;
	/** 目标玩家本场使用的初始卡组类型中文名称 */
	playerDeckTypeName: string;
	/** 对手本场使用的初始卡组类型代码 */
	opponentDeckTypeCode: string;
	/** 对手本场使用的初始卡组类型中文名称 */
	opponentDeckTypeName: string;
	/** 目标玩家本场比赛的天梯积分变动值 */
	playerPointsChange: number;
	/** 对手本场比赛的天梯积分变动值 */
	opponentPointsChange: number;
	/** 目标玩家本场结算后的环境全时期总积分 */
	playerSettledPoints: number;
	/** 对手本场结算后的环境全时期总积分 */
	opponentSettledPoints: number;
	/** 目标玩家卡组快照与下载信息 */
	playerDeck: PlayerMatchDeckInfoDto;
	/** 对手卡组快照与下载信息 */
	opponentDeck: PlayerMatchDeckInfoDto;
	/** 本场 Match 包含的所有小局决斗列表（按 duelIndex 升序） */
	duels: PlayerMatchDuelInfoDto[];
}

/**
 * 对战历史分页信息
 */
export interface PlayerHistoryPaginationDto {
	/** 当前页码（从 1 开始） */
	page: number;
	/** 每页展示记录上限（固定为 20 条） */
	pageSize: number;
	/** 可见或总对战历史记录数（公开模式下为当前可见上限条数，已验证模式下为全时期完整总数） */
	total: number;
}

/**
 * 玩家战绩详情聚合返回结果
 */
export interface PlayerDetailResult {
	/** 是否找到目标玩家账号 */
	found: boolean;
	/** 目标玩家精确昵称 */
	player: string;
	/** 赛制环境标识（"1103" 或 "1109"） */
	format: string;
	/** 当前生效的战绩统计范围（"overall" 或 "season"） */
	scope: "overall" | "season";
	/** 当前生效的半年赛季标签（scope 为 "season" 时存在，否则为 null） */
	season: string | null;
	/** 是否通过密码凭据验证放开全时期完整历史浏览 */
	isVerified: boolean;
	/** 是否提供了密码但验证未通过（提示用户凭据错误，回退到公开模式） */
	authFailed: boolean;
	/** 全时期总战绩天梯摘要（未找到玩家时为 null） */
	overallSummary: PlayerSummaryDto | null;
	/** 全时期卡组使用统计（按场次降序、代码升序排列） */
	overallDeckStats: PlayerDeckStatDto[];
	/** 所选半年赛季战绩天梯摘要（仅当 scope 为 "season" 时返回，否则为 null） */
	seasonSummary: PlayerSummaryDto | null;
	/** 所选半年赛季卡组使用统计（仅当 scope 为 "season" 时返回，否则为 null） */
	seasonDeckStats: PlayerDeckStatDto[] | null;
	/** 全时期最近最多 20 场积分倒推走势曲线（按时间正序排列） */
	ratingTrend: PlayerRatingPointDto[];
	/** 全时期对战历史列表（公开模式最多 20 条，验证后支持分页） */
	matches: PlayerMatchHistoryItemDto[];
	/** 对战历史分页信息 */
	pagination: PlayerHistoryPaginationDto;
}
