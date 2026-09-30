import {
	DECK_TYPE_CATALOG,
	DeckTypeMetadata,
} from "src/shared/deck/domain/classifier/DeckClassifier";
import { calculateBeijingHalfYear, parseHalfYearSeason } from "src/utils/calculateBeijingSeason";
import {
	DeckDetailCatalogItemDto,
	DeckDetailMatchupItemDto,
	DeckDetailQuery,
	DeckDetailTopPlayerDto,
	ValidatedDeckDetailQuery,
} from "./DeckDetailDto";
import {
	DeckDetailRawMatchupRow,
	DeckDetailRawSnapshot,
	DeckDetailRawTopPlayerRow,
	DeckDetailRawUsageCount,
	DeckDetailTimeWindow,
} from "./DeckDetailRepository";

export {
	DeckDetailRawMatchupRow,
	DeckDetailRawTopPlayerRow,
	DeckDetailRawUsageCount,
	DeckDetailRawSnapshot,
	DeckDetailTimeWindow,
};

/** 支持的赛制环境标识 */
export const SUPPORTED_FORMATS = Object.freeze(["1103", "1109"] as const);

/** 专精玩家上榜所需最低有效 Match 场次数（固定 25 场） */
export const MIN_TOP_PLAYER_MATCHES = 25;

/** 未知对手代码与名称 */
export const UNKNOWN_DECK_TYPE_CODE = "unknown";
export const UNKNOWN_DECK_TYPE_NAME_ZH = "未知";

/** 其他类型代码（需在详情与对手中完全排除） */
export const OTHERS_DECK_TYPE_CODE = "OTHERS";

/** 合计项代码与名称 */
export const TOTAL_MATCHUP_CODE = "TOTAL";
export const TOTAL_MATCHUP_NAME_ZH = "合计（不含其他，含未知对手）";

/**
 * 八计数结构接口
 */
export interface DeckDetailEightCounts {
	matches: number;
	matchWins: number;
	firstMatches: number;
	firstWins: number;
	secondMatches: number;
	secondWins: number;
	unknownSeatMatches: number;
	unknownSeatWins: number;
}

/**
 * 卡组选择解析结果联合类型
 */
export type DeckSelectionResult =
	| {
			kind: "selected";
			selected: DeckDetailCatalogItemDto;
			candidates: DeckDetailCatalogItemDto[];
			searchQuery: string | null;
	  }
	| {
			kind: "candidates";
			candidates: DeckDetailCatalogItemDto[];
			searchQuery: string | null;
	  }
	| {
			kind: "not_found";
			code: string;
	  }
	| {
			kind: "none";
			notFound: boolean;
			candidates: DeckDetailCatalogItemDto[];
			searchQuery: string | null;
	  };

/**
 * 将 Date 格式化为北京时间墙钟字符串 "YYYY-MM-DD HH:mm:ss"
 */
export function formatBeijingDateTime(date: Date): string {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	const parts = formatter.formatToParts(date);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
	return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/**
 * 校验卡组详情 HTTP 查询参数
 * 业务意图：
 * 1. 严格校验环境（1103/1109），拒绝非法环境；
 * 2. period 缺省时取北京时间当前半年，禁止查询未来半年或非法的年月格式；
 * 3. deckTypeCode 与 q 互斥，禁止同时提交；
 * 4. 显式排除 OTHERS 和 unknown 作为查询目标；
 * 5. q 限制最多 64 字符。
 */
export function validateDeckDetailQuery(
	query: DeckDetailQuery,
	now: Date = new Date(),
): ValidatedDeckDetailQuery {
	const format = (query.format ?? "").trim();
	if (!SUPPORTED_FORMATS.includes(format as any)) {
		throw new Error(`不支持的赛制环境: ${format}`);
	}

	const currentHalfYear = calculateBeijingHalfYear(now);
	let period: string;

	if (query.period !== undefined && query.period !== null && query.period.trim() !== "") {
		const trimmedPeriod = query.period.trim();
		let parsed;
		try {
			parsed = parseHalfYearSeason(trimmedPeriod);
		} catch {
			throw new Error(`无效的半年周期格式: ${trimmedPeriod}，必须为 YYYYH1 或 YYYYH2`);
		}

		// 检查是否为未来半年
		if (
			parsed.year > currentHalfYear.year ||
			(parsed.year === currentHalfYear.year && parsed.half > currentHalfYear.half)
		) {
			throw new Error(`未来半年暂无统计数据: ${trimmedPeriod}`);
		}
		period = parsed.label;
	} else {
		period = currentHalfYear.label;
	}

	const rawDeckTypeCode = query.deckTypeCode !== undefined ? String(query.deckTypeCode).trim() : "";
	const rawQ = query.q !== undefined ? String(query.q).trim() : "";

	if (rawDeckTypeCode && rawQ) {
		throw new Error("不能同时指定卡组类型代码与搜索关键词");
	}

	let deckTypeCode: string | undefined;
	if (rawDeckTypeCode) {
		if (rawDeckTypeCode.toUpperCase() === OTHERS_DECK_TYPE_CODE) {
			throw new Error("不能查询其他卡组类型");
		}
		if (rawDeckTypeCode.toLowerCase() === UNKNOWN_DECK_TYPE_CODE) {
			throw new Error("不能查询未知卡组类型");
		}
		deckTypeCode = rawDeckTypeCode;
	}

	let q: string | undefined;
	if (rawQ) {
		if (rawQ.length > 64) {
			throw new Error("搜索关键词不能超过 64 个字符");
		}
		q = rawQ;
	}

	return {
		format,
		period,
		deckTypeCode,
		q,
	};
}

/**
 * 获取指定环境下的全部具名卡组元数据列表（已排除 OTHERS）
 */
export function getNamedDeckTypes(format: string): DeckTypeMetadata[] {
	const catalog = DECK_TYPE_CATALOG[format] ?? [];
	return catalog.filter((item) => item.code !== OTHERS_DECK_TYPE_CODE);
}

/**
 * 构建用于公开展示的具名卡组目录
 */
export function buildDeckDetailCatalog(format: string): DeckDetailCatalogItemDto[] {
	return getNamedDeckTypes(format).map((item) => ({
		code: item.code,
		nameZh: item.nameZh,
	}));
}

/**
 * 根据卡组代码或搜索关键词解析选中的卡组
 * 业务意图：
 * 1. 若提交有效具名代码，直接在目录匹配，未匹配返回 not_found（用于 Controller 返回 404）；
 * 2. 若提交 q，进行不区分大小写的字面子串匹配，特殊符号 % 与 _ 不作通配符处理；
 * 3. 搜索唯一命中时自动选中；多命中时返回候选列表供用户二次选择；零命中返回 notFound=true；
 * 4. 若无代码也无搜索，返回完整目录供首屏展示，selected 为 null。
 */
export function resolveDeckSelection(
	format: string,
	deckTypeCode?: string,
	q?: string,
): DeckSelectionResult {
	const namedTypes = getNamedDeckTypes(format);

	if (deckTypeCode) {
		const found = namedTypes.find((item) => item.code.toUpperCase() === deckTypeCode.toUpperCase());
		if (!found) {
			return { kind: "not_found", code: deckTypeCode };
		}
		const selectedDto: DeckDetailCatalogItemDto = { code: found.code, nameZh: found.nameZh };
		return {
			kind: "selected",
			selected: selectedDto,
			candidates: [selectedDto],
			searchQuery: null,
		};
	}

	if (q) {
		const lowerQ = q.toLowerCase();
		const matched = namedTypes.filter((item) => item.nameZh.toLowerCase().includes(lowerQ));
		const candidates: DeckDetailCatalogItemDto[] = matched.map((item) => ({
			code: item.code,
			nameZh: item.nameZh,
		}));

		if (candidates.length === 0) {
			return {
				kind: "none",
				notFound: true,
				candidates: [],
				searchQuery: q,
			};
		}

		if (candidates.length === 1) {
			return {
				kind: "selected",
				selected: candidates[0],
				candidates,
				searchQuery: q,
			};
		}

		return {
			kind: "candidates",
			candidates,
			searchQuery: q,
		};
	}

	const allCandidates = namedTypes.map((item) => ({
		code: item.code,
		nameZh: item.nameZh,
	}));
	return {
		kind: "none",
		notFound: false,
		candidates: allCandidates,
		searchQuery: null,
	};
}

/**
 * 校验八计数恒等守恒与胜场上下界
 * 业务意图：
 * 综合场数必须严格等于先攻、后攻与未知座次之和；
 * 各分类胜场不得超过对应场数。
 */
export function validateEightCountsInvariant(counts: DeckDetailEightCounts): void {
	if (counts.firstWins > counts.firstMatches) {
		throw new Error(
			`胜场不能大于场数: firstWins (${counts.firstWins}) > firstMatches (${counts.firstMatches})`,
		);
	}
	if (counts.secondWins > counts.secondMatches) {
		throw new Error(
			`胜场不能大于场数: secondWins (${counts.secondWins}) > secondMatches (${counts.secondMatches})`,
		);
	}
	if (counts.unknownSeatWins > counts.unknownSeatMatches) {
		throw new Error(
			`胜场不能大于场数: unknownSeatWins (${counts.unknownSeatWins}) > unknownSeatMatches (${counts.unknownSeatMatches})`,
		);
	}
	if (counts.matchWins > counts.matches) {
		throw new Error(
			`胜场不能大于场数: matchWins (${counts.matchWins}) > matches (${counts.matches})`,
		);
	}

	const expectedMatches = counts.firstMatches + counts.secondMatches + counts.unknownSeatMatches;
	const expectedWins = counts.firstWins + counts.secondWins + counts.unknownSeatWins;

	if (counts.matches !== expectedMatches || counts.matchWins !== expectedWins) {
		throw new Error(
			`计数守恒校验失败: matches (${counts.matches} !== ${expectedMatches}) 或 matchWins (${counts.matchWins} !== ${expectedWins})`,
		);
	}
}

/**
 * 根据八计数计算各维度胜率（保留 4 位小数，分母为 0 时返回 null）
 */
export function calculateMatchupRates(counts: DeckDetailEightCounts): {
	matchWinRate: number | null;
	firstWinRate: number | null;
	secondWinRate: number | null;
} {
	const matchWinRate =
		counts.matches > 0 ? Number((counts.matchWins / counts.matches).toFixed(4)) : null;
	const firstWinRate =
		counts.firstMatches > 0 ? Number((counts.firstWins / counts.firstMatches).toFixed(4)) : null;
	const secondWinRate =
		counts.secondMatches > 0 ? Number((counts.secondWins / counts.secondMatches).toFixed(4)) : null;

	return {
		matchWinRate,
		firstWinRate,
		secondWinRate,
	};
}

/**
 * 计算具名卡组使用占比（保留 4 位小数，分母为 0 时返回 null）
 */
export function calculateUsageRate(count: number, denominator: number): number | null {
	if (denominator <= 0) {
		return null;
	}
	return Number((count / denominator).toFixed(4));
}

/**
 * 聚合所有对手得到合计行
 */
export function aggregateTotalMatchup(
	matchups: DeckDetailMatchupItemDto[],
): DeckDetailMatchupItemDto {
	let matches = 0;
	let matchWins = 0;
	let firstMatches = 0;
	let firstWins = 0;
	let secondMatches = 0;
	let secondWins = 0;
	let unknownSeatMatches = 0;
	let unknownSeatWins = 0;

	for (const m of matchups) {
		matches += m.matches;
		matchWins += m.matchWins;
		firstMatches += m.firstMatches;
		firstWins += m.firstWins;
		secondMatches += m.secondMatches;
		secondWins += m.secondWins;
		unknownSeatMatches += m.unknownSeatMatches;
		unknownSeatWins += m.unknownSeatWins;
	}

	const counts: DeckDetailEightCounts = {
		matches,
		matchWins,
		firstMatches,
		firstWins,
		secondMatches,
		secondWins,
		unknownSeatMatches,
		unknownSeatWins,
	};

	validateEightCountsInvariant(counts);
	const rates = calculateMatchupRates(counts);

	return {
		opponentCode: TOTAL_MATCHUP_CODE,
		opponentNameZh: TOTAL_MATCHUP_NAME_ZH,
		...counts,
		...rates,
	};
}

/**
 * 组装并排序对阵列表
 * 业务意图：
 * 1. 完整包含当前环境所有具名卡组，即使无样本也补零显示；
 * 2. 具名对手按 matches 降序、opponentCode 升序排序；
 * 3. 未知对手（unknown）仅在有对局样本时出现在最末尾，无样本时不出现。
 */
export function sortMatchupList(
	rawRows: DeckDetailRawMatchupRow[],
	catalog: readonly DeckTypeMetadata[],
): DeckDetailMatchupItemDto[] {
	const rawMap = new Map<string, DeckDetailRawMatchupRow>();
	for (const r of rawRows) {
		rawMap.set(r.opponentCode, r);
	}

	const namedList: DeckDetailMatchupItemDto[] = [];
	for (const item of catalog) {
		const row = rawMap.get(item.code);
		const counts: DeckDetailEightCounts = row
			? {
					matches: row.matches,
					matchWins: row.matchWins,
					firstMatches: row.firstMatches,
					firstWins: row.firstWins,
					secondMatches: row.secondMatches,
					secondWins: row.secondWins,
					unknownSeatMatches: row.unknownSeatMatches,
					unknownSeatWins: row.unknownSeatWins,
				}
			: {
					matches: 0,
					matchWins: 0,
					firstMatches: 0,
					firstWins: 0,
					secondMatches: 0,
					secondWins: 0,
					unknownSeatMatches: 0,
					unknownSeatWins: 0,
				};

		validateEightCountsInvariant(counts);
		const rates = calculateMatchupRates(counts);

		namedList.push({
			opponentCode: item.code,
			opponentNameZh: item.nameZh,
			...counts,
			...rates,
		});
	}

	// 具名卡组按 matches DESC, opponentCode ASC 稳定排序
	namedList.sort((a, b) => {
		if (b.matches !== a.matches) {
			return b.matches - a.matches;
		}
		return a.opponentCode.localeCompare(b.opponentCode);
	});

	// 处理未知对手：仅在有样本时加入末尾
	const unknownRow = rawMap.get(UNKNOWN_DECK_TYPE_CODE);
	if (unknownRow && unknownRow.matches > 0) {
		const unknownCounts: DeckDetailEightCounts = {
			matches: unknownRow.matches,
			matchWins: unknownRow.matchWins,
			firstMatches: unknownRow.firstMatches,
			firstWins: unknownRow.firstWins,
			secondMatches: unknownRow.secondMatches,
			secondWins: unknownRow.secondWins,
			unknownSeatMatches: unknownRow.unknownSeatMatches,
			unknownSeatWins: unknownRow.unknownSeatWins,
		};
		validateEightCountsInvariant(unknownCounts);
		const unknownRates = calculateMatchupRates(unknownCounts);

		namedList.push({
			opponentCode: UNKNOWN_DECK_TYPE_CODE,
			opponentNameZh: UNKNOWN_DECK_TYPE_NAME_ZH,
			...unknownCounts,
			...unknownRates,
		});
	}

	return namedList;
}

/**
 * 过滤、排序并生成专精玩家 Top10 榜单
 * 业务意图：
 * 1. 严格过滤场数 >= 25 场的达标玩家；
 * 2. 排序优先级：未四舍五入的胜率降序 -> 场数降序 -> 昵称字典序升序；
 * 3. 截取前 10 名并赋予 1-10 的排名。
 */
export function sortAndRankTopPlayers(
	rawPlayers: DeckDetailRawTopPlayerRow[],
	minMatches: number = MIN_TOP_PLAYER_MATCHES,
): DeckDetailTopPlayerDto[] {
	const eligible = rawPlayers.filter((p) => p.matches >= minMatches);

	eligible.sort((a, b) => {
		// 未四舍五入的高精度胜率比较
		const rateA = a.matches > 0 ? a.wins / a.matches : 0;
		const rateB = b.matches > 0 ? b.wins / b.matches : 0;
		if (Math.abs(rateB - rateA) > 1e-9) {
			return rateB - rateA;
		}
		// 场数降序
		if (b.matches !== a.matches) {
			return b.matches - a.matches;
		}
		// 昵称升序
		return a.username.localeCompare(b.username);
	});

	const top10 = eligible.slice(0, 10);
	return top10.map((p, idx) => ({
		rank: idx + 1,
		username: p.username,
		matches: p.matches,
		wins: p.wins,
		losses: p.losses,
		winRate: Number((p.matches > 0 ? p.wins / p.matches : 0).toFixed(4)),
	}));
}

/**
 * 构建北京时间半年查询时间窗口
 * 业务意图：
 * 1. H1 开始于 01-01 00:00:00，结束于 07-01 00:00:00；
 * 2. H2 开始于 07-01 00:00:00，结束于 次年 01-01 00:00:00；
 * 3. 若为当前正在进行的半年周期，dataEndExclusive 截取到本次查询执行时间，历史半年则取 windowEndExclusive。
 */
export function buildDeckDetailTimeWindow(
	period: string,
	now: Date = new Date(),
	dbQueriedAt?: Date,
): DeckDetailTimeWindow {
	const parsed = parseHalfYearSeason(period);
	const currentHalfYear = calculateBeijingHalfYear(now);
	const isOngoing = currentHalfYear.label === period;

	const windowStart = `${parsed.year}-${parsed.half === 1 ? "01" : "07"}-01 00:00:00`;
	const windowEndExclusive =
		parsed.half === 1 ? `${parsed.year}-07-01 00:00:00` : `${parsed.year + 1}-01-01 00:00:00`;

	const dataEndExclusive = isOngoing
		? formatBeijingDateTime(dbQueriedAt ?? now)
		: windowEndExclusive;

	return {
		period,
		windowStart,
		windowEndExclusive,
		dataEndExclusive,
		isOngoing,
	};
}
