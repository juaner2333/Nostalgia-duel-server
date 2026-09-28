import { DECK_TYPE_CATALOG } from "@shared/deck/domain/classifier/DeckClassifier";
import { HalfYearWindow } from "../domain/HalfYearWindow";
import { CdbCardMetadataProvider } from "../infrastructure/cdb/CdbCardMetadataProvider";
import { UsageStatRunData } from "../domain/UsageConsistencyValidator";

export interface UsageSnapshotData {
	readonly run: UsageStatRunData | null;
	readonly total: number;
	readonly deckRows?: readonly { deckTypeCode: string; deckCount: number }[];
	readonly cardRows?: readonly {
		cardId: number;
		deckCount: number;
		copies1: number;
		copies2: number;
		copies3: number;
	}[];
}

export interface UsageQueryRepository {
	findRun(formatId: string, windowStart: string): Promise<UsageStatRunData | null>;
	listRuns(formatId: string): Promise<UsageStatRunData[]>;
	queryDecks(
		formatId: string,
		windowStart: string,
		limit: number,
		offset: number,
	): Promise<{
		total: number;
		rows: { deckTypeCode: string; deckCount: number }[];
	}>;
	queryCards(
		formatId: string,
		windowStart: string,
		metric: string,
		limit: number,
		offset: number,
	): Promise<{
		total: number;
		rows: {
			cardId: number;
			deckCount: number;
			copies1: number;
			copies2: number;
			copies3: number;
		}[];
	}>;
	querySnapshot(
		formatId: string,
		windowStart: string,
		metric: string,
		limit: number,
		offset: number,
	): Promise<UsageSnapshotData>;
}

export interface GetUsageQuery {
	format: string;
	metric: string;
	period?: string;
	page?: number;
	pageSize?: number;
}

export interface DeckUsageItem {
	rank: number;
	code: string;
	nameZh: string;
	deckCount: number;
	usageRate: number | null;
}

export interface CardUsageItem {
	rank: number;
	cardId: number;
	name: string;
	deckCount: number;
	usageRate: number | null;
	copies1: number;
	copies2: number;
	copies3: number;
}

export interface UsageResponse {
	format: string;
	metric: string;
	period: string;
	windowStart: string;
	windowEndExclusive: string;
	dataEndExclusive: string;
	timezone: string;
	publishedAt: string;
	totalDecks: number;
	sideKnownDecks: number;
	denominator: number;
	total: number;
	page: number;
	pageSize: number;
	decks?: DeckUsageItem[];
	cards?: CardUsageItem[];
}

export interface PeriodItem {
	period: string;
	windowStart: string;
	windowEndExclusive: string;
	dataEndExclusive: string;
	publishedAt: string;
	isFinalized: boolean;
}

export interface UsagePeriodsResponse {
	format: string;
	periods: PeriodItem[];
}

const VALID_METRICS = new Set(["deck", "monster", "spell", "trap", "extra", "side"]);

export class GetUsageStatisticsUseCase {
	constructor(
		private readonly repository: UsageQueryRepository,
		private readonly metadataProvider: CdbCardMetadataProvider,
	) {}

	public async getPeriods(formatId: string): Promise<UsagePeriodsResponse> {
		if (formatId !== "1103" && formatId !== "1109") {
			throw new Error(`Unsupported format: ${formatId}`);
		}

		const runs = await this.repository.listRuns(formatId);
		const periods: PeriodItem[] = runs.map((r) => {
			const periodStr = HalfYearWindow.periodFromWindowStart(r.windowStart);
			return {
				period: periodStr,
				windowStart: r.windowStart,
				windowEndExclusive: r.windowEndExclusive,
				dataEndExclusive: r.dataEndExclusive,
				publishedAt: r.publishedAt.toISOString(),
				isFinalized: r.dataEndExclusive === r.windowEndExclusive,
			};
		});

		return { format: formatId, periods };
	}

	public async getUsage(query: GetUsageQuery): Promise<UsageResponse> {
		const formatId = query.format;
		if (formatId !== "1103" && formatId !== "1109") {
			throw new Error(`Unsupported format: ${formatId}`);
		}

		const metric = query.metric;
		if (!VALID_METRICS.has(metric)) {
			throw new Error(`Invalid metric parameter: ${metric}`);
		}

		const page = query.page ?? 1;
		if (!Number.isInteger(page) || page < 1) {
			throw new Error("Invalid page parameter: must be a positive integer");
		}

		const pageSize = query.pageSize ?? 50;
		if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
			throw new Error("Invalid pageSize parameter: must be an integer between 1 and 100");
		}

		const window = query.period
			? HalfYearWindow.fromPeriodString(query.period)
			: HalfYearWindow.current();

		const offset = (page - 1) * pageSize;
		const snapshot = await this.repository.querySnapshot(
			formatId,
			window.windowStart,
			metric,
			pageSize,
			offset,
		);

		const run = snapshot.run;
		if (!run) {
			throw new Error(
				`Usage statistics not ready for format ${formatId} and period ${window.period}`,
			);
		}

		await this.metadataProvider.load();

		const denominator = metric === "side" ? run.sideKnownDecks : run.totalDecks;

		const baseResponse = {
			format: formatId,
			metric,
			period: window.period,
			windowStart: run.windowStart,
			windowEndExclusive: run.windowEndExclusive,
			dataEndExclusive: run.dataEndExclusive,
			timezone: "Asia/Shanghai",
			publishedAt: run.publishedAt.toISOString(),
			totalDecks: run.totalDecks,
			sideKnownDecks: run.sideKnownDecks,
			denominator,
			page,
			pageSize,
		};

		if (metric === "deck") {
			const rows = snapshot.deckRows ?? [];
			const catalog = DECK_TYPE_CATALOG[formatId] ?? [];
			const nameMap = new Map(catalog.map((c) => [c.code, c.nameZh]));

			const decks: DeckUsageItem[] = rows.map((r, index) => {
				const usageRate = denominator > 0 ? Number((r.deckCount / denominator).toFixed(6)) : null;
				return {
					rank: offset + index + 1,
					code: r.deckTypeCode,
					nameZh: nameMap.get(r.deckTypeCode) ?? r.deckTypeCode,
					deckCount: r.deckCount,
					usageRate,
				};
			});

			return { ...baseResponse, total: snapshot.total, decks };
		} else {
			const rows = snapshot.cardRows ?? [];

			const cards: CardUsageItem[] = rows.map((r, index) => {
				const meta = this.metadataProvider.getCardMetadata(r.cardId);
				const name = meta?.name || String(r.cardId);
				const usageRate = denominator > 0 ? Number((r.deckCount / denominator).toFixed(6)) : null;
				return {
					rank: offset + index + 1,
					cardId: r.cardId,
					name,
					deckCount: r.deckCount,
					usageRate,
					copies1: r.copies1,
					copies2: r.copies2,
					copies3: r.copies3,
				};
			});

			return { ...baseResponse, total: snapshot.total, cards };
		}
	}
}
