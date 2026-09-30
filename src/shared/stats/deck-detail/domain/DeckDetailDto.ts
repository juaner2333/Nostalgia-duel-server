/**
 * 卡组详情 HTTP 查询参数
 */
export interface DeckDetailQuery {
	/** 赛制环境标识（支持 "1103" 或 "1109"） */
	format: string;
	/** 半年周期标识（例如 "2026H1"、"2026H2"，不传时缺省为北京时间当前半年） */
	period?: string;
	/** 卡组类型代码（例如 "D01"，与 q 互斥） */
	deckTypeCode?: string;
	/** 搜索关键词（最多 64 字符，字面匹配卡组中文名，与 deckTypeCode 互斥） */
	q?: string;
}

/**
 * 校验后的卡组详情查询参数
 */
export interface ValidatedDeckDetailQuery {
	/** 赛制环境标识（"1103" 或 "1109"） */
	format: string;
	/** 半年周期标识（例如 "2026H2"） */
	period: string;
	/** 卡组类型代码（已去除首尾空白） */
	deckTypeCode?: string;
	/** 搜索关键词（已去除首尾空白） */
	q?: string;
}

/**
 * 具名卡组目录项 DTO
 */
export interface DeckDetailCatalogItemDto {
	/** 卡组类型代码（例如 "D01"） */
	code: string;
	/** 卡组类型中文名称（例如 "代行天使"） */
	nameZh: string;
}

/**
 * 当前选中的卡组类型信息 DTO
 */
export interface DeckDetailSelectedDto {
	/** 卡组类型代码（例如 "D01"） */
	code: string;
	/** 卡组类型中文名称（例如 "代行天使"） */
	nameZh: string;
}

/**
 * 具名卡组使用占比 DTO
 */
export interface DeckDetailUsageDto {
	/** 所选卡组有效使用份数（等于对阵合计场数 matches） */
	count: number;
	/** 分母：当前环境所选半年全部具名卡组有效使用份数之和（不含其他） */
	denominator: number;
	/** 使用占比（count / denominator，保留 4 位小数；分母为 0 时为 null） */
	rate: number | null;
}

/**
 * 单个对手或合计的 Match 对阵与先后攻统计 DTO
 */
export interface DeckDetailMatchupItemDto {
	/** 对手卡组类型代码（具名类型代码、"unknown" 或 "TOTAL"） */
	opponentCode: string;
	/** 对手卡组中文名称（例如 "代行天使"、"未知" 或 "合计（不含其他，含未知对手）"） */
	opponentNameZh: string;
	/** 综合 Match 场次数（firstMatches + secondMatches + unknownSeatMatches） */
	matches: number;
	/** 综合 Match 获胜场次数（firstWins + secondWins + unknownSeatWins） */
	matchWins: number;
	/** G1 先攻 Match 场次数 */
	firstMatches: number;
	/** G1 先攻 Match 获胜场次数 */
	firstWins: number;
	/** G1 后攻 Match 场次数 */
	secondMatches: number;
	/** G1 后攻 Match 获胜场次数 */
	secondWins: number;
	/** G1 座次未知 Match 场次数 */
	unknownSeatMatches: number;
	/** G1 座次未知 Match 获胜场次数 */
	unknownSeatWins: number;
	/** 综合胜率（matchWins / matches，保留 4 位小数；场数为 0 时为 null） */
	matchWinRate: number | null;
	/** G1 先攻胜率（firstWins / firstMatches，保留 4 位小数；场数为 0 时为 null） */
	firstWinRate: number | null;
	/** G1 后攻胜率（secondWins / secondMatches，保留 4 位小数；场数为 0 时为 null） */
	secondWinRate: number | null;
}

/**
 * 卡组专精玩家胜率 Top10 榜单项 DTO
 */
export interface DeckDetailTopPlayerDto {
	/** 排名（从 1 到 10） */
	rank: number;
	/** 玩家可见公开昵称 */
	username: string;
	/** 该玩家使用目标卡组的有效 Match 场次数（至少 25 场） */
	matches: number;
	/** 该玩家使用目标卡组获胜的 Match 场次数 */
	wins: number;
	/** 该玩家使用目标卡组失败的 Match 场次数 */
	losses: number;
	/** 胜率（wins / matches，保留 4 位小数） */
	winRate: number;
}

/**
 * 卡组详情完整响应 DTO
 */
export interface DeckDetailDto {
	/** 赛制环境标识（"1103" 或 "1109"） */
	format: string;
	/** 半年周期标识（例如 "2026H2"） */
	period: string;
	/** 统计时区标识（固定为 "Asia/Shanghai"） */
	timezone: string;
	/** 半年窗口开始时刻（例如 "2026-07-01 00:00:00"） */
	windowStart: string;
	/** 半年窗口结束时刻（开区间，例如 "2027-01-01 00:00:00"） */
	windowEndExclusive: string;
	/** 数据截止时刻（当前半年为本次查询时刻，历史半年为窗口结束时刻） */
	dataEndExclusive: string;
	/** 数据库查询执行时间戳（ISO 8601 格式） */
	queriedAt: string;
	/** 当前环境的全部具名卡组目录（不含 OTHERS） */
	catalog: DeckDetailCatalogItemDto[];
	/** 当前环境是否存在具名分类目录（1109 为 true，1103 为 false） */
	hasNamedCatalog: boolean;
	/** 当前选中的卡组（未选中时为 null） */
	selected: DeckDetailSelectedDto | null;
	/** 搜索命中候选列表（搜索唯一命中时选中且为单项，多命中时供选择，无搜索时为完整目录） */
	candidates: DeckDetailCatalogItemDto[];
	/** 搜索关键词（未提交搜索时为 null） */
	searchQuery: string | null;
	/** 是否因搜索零命中未找到卡组 */
	notFound: boolean;
	/** 具名卡组使用占比（未选中时为 null） */
	usage: DeckDetailUsageDto | null;
	/** 对阵合计信息（未选中时为 null） */
	total: DeckDetailMatchupItemDto | null;
	/** 按对手分组的 Match 对阵列表（未选中时为空数组） */
	matchups: DeckDetailMatchupItemDto[];
	/** 玩家上榜门槛场次数（固定为 25 场） */
	minPlayerMatches: number;
	/** 玩家胜率 Top10 榜单（未选中时为空数组） */
	topPlayers: DeckDetailTopPlayerDto[];
}
