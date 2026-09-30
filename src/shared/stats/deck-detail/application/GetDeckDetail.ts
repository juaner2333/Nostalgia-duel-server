import { Logger } from "src/shared/logger/domain/Logger";
import { DeckDetailDto, DeckDetailQuery } from "../domain/DeckDetailDto";
import { DeckDetailRepository } from "../domain/DeckDetailRepository";
import {
	aggregateTotalMatchup,
	buildDeckDetailCatalog,
	buildDeckDetailTimeWindow,
	calculateUsageRate,
	getNamedDeckTypes,
	MIN_TOP_PLAYER_MATCHES,
	resolveDeckSelection,
	sortAndRankTopPlayers,
	sortMatchupList,
	validateDeckDetailQuery,
} from "../domain/DeckDetailRules";

/**
 * 卡组未找到异常类（用于 HTTP 控制层返回 404）
 */
export class DeckDetailNotFoundError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "DeckDetailNotFoundError";
	}
}

/**
 * 卡组详情应用层用例
 * 业务意图与设计决策（Trade-offs）：
 * 1. 负责编排输入校验、卡组目录解析、选择状态判断与数据聚合组装；
 * 2. 性能守护：在无卡组选择或搜索多个候选时，坚决不发起底层数据库比赛扫描；
 * 3. 结果装配：在单一快照基础上，使用同一套样本标准组装使用占比、Match 对阵列表与 Top10 榜单。
 */
export class GetDeckDetail {
	public constructor(
		private readonly deckDetailRepository: DeckDetailRepository,
		private readonly logger: Logger,
	) {}

	/**
	 * 执行卡组详情查询用例
	 *
	 * @param rawQuery 原始查询参数
	 * @param now 可选系统基准时间（主要用于单元测试注入）
	 */
	public async execute(rawQuery: DeckDetailQuery, now: Date = new Date()): Promise<DeckDetailDto> {
		// 1. 校验输入参数并规范化
		const validated = validateDeckDetailQuery(rawQuery, now);

		// 2. 获取当前环境具名卡组目录
		const catalog = buildDeckDetailCatalog(validated.format);
		const hasNamedCatalog = catalog.length > 0;

		// 3. 解析用户选择状态
		const selection = resolveDeckSelection(validated.format, validated.deckTypeCode, validated.q);

		// 4. 构建北京时间半年查询时间窗口
		let timeWindow = buildDeckDetailTimeWindow(validated.period, now);

		// 5. 若代码不存在，抛出 404 领域异常
		if (selection.kind === "not_found") {
			throw new DeckDetailNotFoundError(`未找到卡组类型: ${selection.code}`);
		}

		// 6. 若未选中具体卡组（如首屏无输入、搜索多候选、搜索零命中），直接返回目录状态，不发起数据库查询
		if (selection.kind !== "selected") {
			return {
				format: validated.format,
				period: validated.period,
				timezone: "Asia/Shanghai",
				windowStart: timeWindow.windowStart,
				windowEndExclusive: timeWindow.windowEndExclusive,
				dataEndExclusive: timeWindow.dataEndExclusive,
				queriedAt: now.toISOString(),
				catalog,
				hasNamedCatalog,
				selected: null,
				candidates: selection.candidates,
				searchQuery: selection.searchQuery,
				notFound: selection.kind === "none" ? selection.notFound : false,
				usage: null,
				total: null,
				matchups: [],
				minPlayerMatches: MIN_TOP_PLAYER_MATCHES,
				topPlayers: [],
			};
		}

		// 7. 用户选中了具体具名卡组，调用持久化层单次快照读取
		const targetDeck = selection.selected;
		this.logger.info("Executing deck detail snapshot query", {
			format: validated.format,
			deckTypeCode: targetDeck.code,
			period: validated.period,
		});

		const snapshot = await this.deckDetailRepository.getDeckDetailSnapshot(
			validated.format,
			targetDeck.code,
			timeWindow,
		);

		timeWindow = snapshot.timeWindow;

		// 8. 计算具名卡组使用占比
		// 分母为当前环境全部具名卡组各自使用份数之和（不含 OTHERS）
		const denominator = snapshot.usageCounts.reduce((acc, curr) => acc + curr.count, 0);
		const targetUsageCount =
			snapshot.usageCounts.find((u) => u.deckTypeCode === targetDeck.code)?.count ?? 0;
		const usageRate = calculateUsageRate(targetUsageCount, denominator);

		const usage = {
			count: targetUsageCount,
			denominator,
			rate: usageRate,
		};

		// 9. 组装并排序对阵列表
		const namedMetadata = getNamedDeckTypes(validated.format);
		const sortedMatchups = sortMatchupList(snapshot.matchups, namedMetadata);

		// 10. 聚合对阵合计（合计 matches 严格等于 usage.count）
		const total = aggregateTotalMatchup(sortedMatchups);

		// 11. 筛选并排序专精玩家 Top10 榜单（固定 25 场门槛）
		const topPlayers = sortAndRankTopPlayers(snapshot.topPlayers, MIN_TOP_PLAYER_MATCHES);

		return {
			format: validated.format,
			period: validated.period,
			timezone: "Asia/Shanghai",
			windowStart: timeWindow.windowStart,
			windowEndExclusive: timeWindow.windowEndExclusive,
			dataEndExclusive: timeWindow.dataEndExclusive,
			queriedAt: snapshot.queriedAt.toISOString(),
			catalog,
			hasNamedCatalog,
			selected: targetDeck,
			candidates: selection.candidates,
			searchQuery: selection.searchQuery,
			notFound: false,
			usage,
			total,
			matchups: sortedMatchups,
			minPlayerMatches: MIN_TOP_PLAYER_MATCHES,
			topPlayers,
		};
	}
}
