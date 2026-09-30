/**
 * 卡组详情时间窗口范围定义
 */
export interface DeckDetailTimeWindow {
	/** 半年周期标识（例如 "2026H2"） */
	period: string;
	/** 半年开始时间（北京时间墙钟字符串，包含，格式 "YYYY-MM-DD HH:mm:ss"） */
	windowStart: string;
	/** 半年结束时间（北京时间墙钟字符串，不包含，格式 "YYYY-MM-DD HH:mm:ss"） */
	windowEndExclusive: string;
	/** 数据实际统计截止时间（北京时间墙钟字符串，不包含；当前半年为查询时刻，历史半年为结束时间） */
	dataEndExclusive: string;
	/** 是否为当前进行中的半年周期 */
	isOngoing: boolean;
}

/**
 * 数据库返回的单卡组有效使用份数聚合行
 */
export interface DeckDetailRawUsageCount {
	/** 卡组类型代码 */
	deckTypeCode: string;
	/** 有效使用份数 */
	count: number;
}

/**
 * 数据库返回的对手 Match 对阵八计数聚合行
 */
export interface DeckDetailRawMatchupRow {
	/** 对手卡组类型代码（具名代码或 "unknown"） */
	opponentCode: string;
	/** 综合 Match 场次数 */
	matches: number;
	/** 综合 Match 获胜场次数 */
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
}

/**
 * 数据库返回的玩家战绩聚合行
 */
export interface DeckDetailRawTopPlayerRow {
	/** 玩家公开昵称（已关联账号并过滤未确认账号） */
	username: string;
	/** 使用该卡组有效 Match 场次数 */
	matches: number;
	/** 获胜场次数 */
	wins: number;
	/** 失败场次数 */
	losses: number;
	/** 原始胜率浮点数（未四舍五入） */
	winRate: number;
}

/**
 * 卡组详情数据库快照结果
 */
export interface DeckDetailRawSnapshot {
	/** 数据库事务开始的查询时间戳 */
	queriedAt: Date;
	/** 本次查询生效的时间窗口 */
	timeWindow: DeckDetailTimeWindow;
	/** 当前环境全部具名卡组的使用份数聚合 */
	usageCounts: DeckDetailRawUsageCount[];
	/** 目标卡组对各个对手的对阵聚合结果 */
	matchups: DeckDetailRawMatchupRow[];
	/** 目标卡组专精玩家榜候选集合（场数 >= 25） */
	topPlayers: DeckDetailRawTopPlayerRow[];
}

/**
 * 卡组详情持久化仓库端口
 * 业务意图：
 * 1. 在同一个只读一致事务内读取全量具名使用份数、对手八计数及玩家 Top10；
 * 2. 避免在应用层加载全量比赛行或录像字节，所有聚合在数据库层面完成；
 * 3. 严格遵循排除 OTHERS、保留未知对手、仅取互补有效比赛的样本规则。
 */
export interface DeckDetailRepository {
	/**
	 * 获取指定卡组在指定半年窗口内的一致快照
	 *
	 * @param format 赛制环境标识（"1103" 或 "1109"）
	 * @param deckTypeCode 目标具名卡组类型代码（如 "D01"）
	 * @param timeWindow 统一构建的时间窗口参数
	 */
	getDeckDetailSnapshot(
		format: string,
		deckTypeCode: string,
		timeWindow: DeckDetailTimeWindow,
	): Promise<DeckDetailRawSnapshot>;
}
