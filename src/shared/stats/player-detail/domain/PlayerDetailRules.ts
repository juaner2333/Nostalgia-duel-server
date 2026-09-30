import { calculateBeijingHalfYear } from "src/utils/calculateBeijingSeason";
import { PlayerDeckStatDto, PlayerDetailQuery, PlayerRatingPointDto } from "./PlayerDetailDto";

/** 详情页全时期对战历史固定分页条数 */
export const PLAYER_DETAIL_PAGE_SIZE = 20;

/** 支持的赛制环境列表 */
export const SUPPORTED_FORMATS = Object.freeze(["1103", "1109"] as const);

/**
 * 校验后的玩家详情查询参数
 */
export interface ValidatedPlayerDetailQuery {
	/** 目标玩家昵称（已去除首尾空白） */
	player: string;
	/** 赛制环境标识 */
	format: string;
	/** 统计范围 */
	scope: "overall" | "season";
	/** 半年赛季标识（例如 2026H1，仅在 scope 为 season 时存在） */
	season: string | null;
	/** 可选验证密码 */
	password?: string;
	/** 请求页码（正整数） */
	page: number;
	/** 每页展示记录上限（固定 20） */
	pageSize: number;
}

/**
 * 聚合卡组统计的原始单场比赛输入契约
 */
export interface RawPlayerDeckMatchInput {
	/** 比赛 Match ID */
	matchId: string;
	/** 卡组类型代码 */
	deckTypeCode: string;
	/** 卡组类型中文名称 */
	deckTypeName: string;
	/** 当前玩家是否获胜 */
	winner: boolean;
	/** G1 是否为先手（null 表示未知） */
	g1First: boolean | null;
}

/**
 * 校验并规范化玩家详情查询输入
 * 业务意图：
 * 1. 玩家昵称必须精确且非空，防止子串模糊匹配导致账号信息泄露；
 * 2. 统计范围仅用于控制战绩摘要与卡组使用统计，不得用于过滤全时期历史或曲线；
 * 3. 严格禁止总战绩模式下携带赛季，或传入无效月份（如 2026-09），遇到非法参数直接报错而非静默兼容。
 */
export function validatePlayerDetailQuery(
	query: PlayerDetailQuery,
	now: Date = new Date(),
): ValidatedPlayerDetailQuery {
	const player = (query.player ?? "").trim();
	if (!player) {
		throw new Error("玩家昵称不能为空");
	}

	const format = (query.format ?? "").trim();
	if (!SUPPORTED_FORMATS.includes(format as any)) {
		throw new Error(`不支持的赛制环境: ${format}`);
	}

	const rawScope = query.scope ?? "season";
	if (rawScope !== "overall" && rawScope !== "season") {
		throw new Error(`无效的统计范围: ${rawScope}`);
	}

	let season: string | null = null;
	if (rawScope === "overall") {
		if (query.season !== undefined && query.season !== null && query.season.trim() !== "") {
			throw new Error("总战绩模式不能携带赛季参数");
		}
		season = null;
	} else {
		// season scope
		if (query.season !== undefined && query.season !== null && query.season.trim() !== "") {
			const trimmedSeason = query.season.trim();
			if (!/^(\d{4})H([12])$/.test(trimmedSeason)) {
				throw new Error("无效的半年赛季格式: 必须为 YYYYH1 或 YYYYH2");
			}
			season = trimmedSeason;
		} else {
			// 缺省为北京时间当前半年赛季
			const currentHalfYear = calculateBeijingHalfYear(now);
			season = currentHalfYear.label;
		}
	}

	let page = 1;
	if (query.page !== undefined && query.page !== null) {
		const numPage = Number(query.page);
		if (!Number.isInteger(numPage) || numPage < 1) {
			throw new Error("页码必须为正整数");
		}
		page = numPage;
	}

	return {
		player,
		format,
		scope: rawScope,
		season,
		password: query.password,
		page,
		pageSize: PLAYER_DETAIL_PAGE_SIZE,
	};
}

/**
 * 计算胜率，保留 4 位小数
 */
export function calculateWinRate(wins: number, matches: number): number {
	if (matches <= 0) {
		return 0;
	}
	return Number((wins / matches).toFixed(4));
}

/**
 * 计算 G1 先手率
 * 业务意图：未知先后手不计入分母；若先手和后手已知次数均为 0，返回 null（前端展示为破折号「—」）
 */
export function calculateG1FirstRate(firstCount: number, secondCount: number): number | null {
	const totalKnown = firstCount + secondCount;
	if (totalKnown <= 0) {
		return null;
	}
	return Number((firstCount / totalKnown).toFixed(4));
}

/**
 * 聚合卡组使用统计
 * 业务意图：
 * 1. 严格以整场 Match 为统计单位，一场比赛仅计入一次初始卡组与 G1 先后手；
 * 2. G2 和 G3 的先后手不参与 G1 统计；
 * 3. 缺失卡组快照统计为 "unknown"（"未知"），不得与已分类的 "OTHERS"（"其他"）合并；
 * 4. 排序规则：按场次降序，场次相同时按卡组代码升序稳定排序。
 */
export function aggregateDeckStats(matches: RawPlayerDeckMatchInput[]): PlayerDeckStatDto[] {
	const map = new Map<
		string,
		{
			deckTypeCode: string;
			deckTypeName: string;
			matches: number;
			wins: number;
			losses: number;
			firstCount: number;
			secondCount: number;
		}
	>();

	for (const match of matches) {
		const code = match.deckTypeCode || "unknown";
		const name = match.deckTypeName || (code === "unknown" ? "未知" : code);

		let item = map.get(code);
		if (!item) {
			item = {
				deckTypeCode: code,
				deckTypeName: name,
				matches: 0,
				wins: 0,
				losses: 0,
				firstCount: 0,
				secondCount: 0,
			};
			map.set(code, item);
		}

		item.matches += 1;
		if (match.winner) {
			item.wins += 1;
		} else {
			item.losses += 1;
		}

		if (match.g1First === true) {
			item.firstCount += 1;
		} else if (match.g1First === false) {
			item.secondCount += 1;
		}
	}

	const result: PlayerDeckStatDto[] = [];
	for (const item of map.values()) {
		result.push({
			deckTypeCode: item.deckTypeCode,
			deckTypeName: item.deckTypeName,
			matches: item.matches,
			wins: item.wins,
			losses: item.losses,
			winRate: calculateWinRate(item.wins, item.matches),
			firstCount: item.firstCount,
			secondCount: item.secondCount,
			firstRate: calculateG1FirstRate(item.firstCount, item.secondCount),
		});
	}

	result.sort((a, b) => {
		if (b.matches !== a.matches) {
			return b.matches - a.matches;
		}
		return a.deckTypeCode.localeCompare(b.deckTypeCode);
	});

	return result;
}

/**
 * 计算全时期最近 20 场积分走势曲线
 * 业务意图：
 * 1. 终点始终严格等于玩家当前总积分，确保与战绩摘要完全一致；
 * 2. 输入为按时间降序（最新在前）的最多 20 场比赛增减，从最新积分向前逐场扣除增减倒推；
 * 3. 最终按时间正序（最早在前，最新在后）输出最多 21 个坐标点（包含最早场次开始前的基准点）；
 * 4. 若玩家全时期没有有效比赛，返回空数组。
 */
export function calculateRatingTrend(
	currentOverallPoints: number,
	recentMatchesDesc: Array<{ matchId: string; date: Date | string; pointsChange: number }>,
): PlayerRatingPointDto[] {
	if (recentMatchesDesc.length === 0) {
		return [];
	}

	// 从最新一场开始倒推
	// pointsAfterMatch[i] 是第 i 场结束后的积分
	// 第 0 项为最新比赛结算后的积分 = currentOverallPoints
	let runningPoints = currentOverallPoints;
	const reversedPoints: Array<{ matchId: string; date: string; points: number }> = [];

	for (const m of recentMatchesDesc) {
		reversedPoints.push({
			matchId: m.matchId,
			date: typeof m.date === "string" ? m.date : m.date.toISOString(),
			points: runningPoints,
		});
		// 扣除本场增减，倒推出本场开始前（即上一场结束时）的积分
		runningPoints -= m.pointsChange;
	}

	// runningPoints 此时为可见最早一场开始前的基准初始积分
	const result: PlayerRatingPointDto[] = [
		{
			matchId: null,
			date: null,
			points: runningPoints,
		},
	];

	// 将倒推收集的各场点位反转为时间正序
	for (let i = reversedPoints.length - 1; i >= 0; i--) {
		result.push({
			matchId: reversedPoints[i].matchId,
			date: reversedPoints[i].date,
			points: reversedPoints[i].points,
		});
	}

	return result;
}

/**
 * 倒推计算某页对战历史中每场比赛结算后的累计总积分
 * 业务意图：
 * 列表中的结算后积分必须统一以当前总积分为基准，扣除该场之后全时期的累计增减。
 * 即使跨页或切换统计范围，口径始终全局统一，翻页绝不归零。
 */
export function calculateSettledPointsForMatches(
	currentOverallPoints: number,
	matchesNewestFirst: Array<{ matchId: string; pointsChange: number }>,
	priorNewerPointsSum: number,
): number[] {
	let runningSum = priorNewerPointsSum;
	const settledPoints: number[] = [];

	for (const match of matchesNewestFirst) {
		settledPoints.push(currentOverallPoints - runningSum);
		runningSum += match.pointsChange;
	}

	return settledPoints;
}
