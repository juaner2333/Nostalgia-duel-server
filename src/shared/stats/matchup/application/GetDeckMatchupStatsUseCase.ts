import { DECK_TYPE_CATALOG } from "@shared/deck/domain/classifier/DeckClassifier";
import { HalfYearWindow } from "../../usage/domain/HalfYearWindow";
import { UsageStatRunData } from "../../usage/domain/UsageConsistencyValidator";
import { DeckMatchupRowData } from "../domain/DeckMatchupCalculator";
import { TopDeckSelector } from "../domain/TopDeckSelector";

export class FormatNotSupportedError extends Error {
	constructor(format: string) {
		super(`Format not supported for deck stats: ${format}. Only 1109 is currently supported.`);
		this.name = "FormatNotSupportedError";
	}
}

export class StatsNotReadyError extends Error {
	constructor(period: string) {
		super(`Deck statistics not ready for period ${period}. No published batch found.`);
		this.name = "StatsNotReadyError";
	}
}

export interface DeckMatchupStatsItem {
	matches: number;
	matchWins: number;
	firstMatches: number;
	firstWins: number;
	secondMatches: number;
	secondWins: number;
}

export interface DeckInfo {
	code: string;
	nameZh: string;
	deckCount: number;
}

export interface DeckStatsResponse {
	format: string;
	period: string;
	windowStart: string;
	windowEndExclusive: string;
	dataEndExclusive: string;
	timezone: string;
	publishedAt: string;
	totalPhysicalMatches: number;
	candidateUsageDecks: number;
	decks: DeckInfo[];
	stats: Record<string, DeckMatchupStatsItem>;
}

export interface MatchupQueryRepository {
	findRun(formatId: string, windowStart: string): Promise<UsageStatRunData | null>;
	listRuns(formatId: string): Promise<UsageStatRunData[]>;
	queryTopDecksUsage(
		formatId: string,
		windowStart: string,
	): Promise<{ deckTypeCode: string; deckCount: number }[]>;
	queryMatchupRows(formatId: string, windowStart: string): Promise<DeckMatchupRowData[]>;
}

export class GetDeckMatchupStatsUseCase {
	constructor(private readonly repository: MatchupQueryRepository) {}

	public async execute(query: { format: string; period?: string }): Promise<DeckStatsResponse> {
		if (query.format !== "1109") {
			throw new FormatNotSupportedError(query.format);
		}

		const window = query.period
			? HalfYearWindow.fromPeriodString(query.period)
			: HalfYearWindow.current();

		const run = await this.repository.findRun(query.format, window.windowStart);
		if (!run) {
			throw new StatsNotReadyError(window.period);
		}

		// 1. Get Top 16 decks from usage_deck_rows
		const usageRows = await this.repository.queryTopDecksUsage(query.format, window.windowStart);
		const topDeckCodes = TopDeckSelector.selectTopDecks(query.format, usageRows);

		const catalog = DECK_TYPE_CATALOG[query.format] ?? [];
		const catalogMap = new Map(catalog.map((c) => [c.code, c.nameZh]));
		const usageCountMap = new Map(usageRows.map((r) => [r.deckTypeCode, r.deckCount]));

		const decks: DeckInfo[] = topDeckCodes.map((code) => ({
			code,
			nameZh: catalogMap.get(code) ?? code,
			deckCount: usageCountMap.get(code) ?? 0,
		}));

		const candidateUsageDecks = decks.reduce((acc, d) => acc + d.deckCount, 0);

		// 2. Query matchup rows from stats_deck_matchups
		const matchupRows = await this.repository.queryMatchupRows(query.format, window.windowStart);
		const totalPhysicalMatches = matchupRows.reduce((acc, r) => acc + r.matchCount, 0);

		// Map of `${firstDeckCode}::${secondDeckCode}` -> { matchCount, firstWins }
		const physicalMap = new Map<string, { matchCount: number; firstWins: number }>();
		for (const row of matchupRows) {
			physicalMap.set(`${row.firstDeckCode}::${row.secondDeckCode}`, {
				matchCount: row.matchCount,
				firstWins: row.firstWins,
			});
		}

		// 3. Construct stats dictionary for all pairs in topDeckCodes
		const stats: Record<string, DeckMatchupStatsItem> = {};

		for (const x of topDeckCodes) {
			// Row total accumulator for X::TOP16
			const top16Total: DeckMatchupStatsItem = {
				matches: 0,
				matchWins: 0,
				firstMatches: 0,
				firstWins: 0,
				secondMatches: 0,
				secondWins: 0,
			};

			for (const y of topDeckCodes) {
				const item: DeckMatchupStatsItem = {
					matches: 0,
					matchWins: 0,
					firstMatches: 0,
					firstWins: 0,
					secondMatches: 0,
					secondWins: 0,
				};

				if (x === y) {
					// Mirror match (A vs A)
					const physical = physicalMap.get(`${x}::${x}`);
					if (physical && physical.matchCount > 0) {
						item.matches = 2 * physical.matchCount;
						item.matchWins = physical.matchCount;
						item.firstMatches = physical.matchCount;
						item.firstWins = physical.firstWins;
						item.secondMatches = physical.matchCount;
						item.secondWins = physical.matchCount - physical.firstWins;
					}
				} else {
					// Different decks (X vs Y)
					const physicalXY = physicalMap.get(`${x}::${y}`);
					if (physicalXY && physicalXY.matchCount > 0) {
						item.firstMatches = physicalXY.matchCount;
						item.firstWins = physicalXY.firstWins;
					}

					const physicalYX = physicalMap.get(`${y}::${x}`);
					if (physicalYX && physicalYX.matchCount > 0) {
						item.secondMatches = physicalYX.matchCount;
						item.secondWins = physicalYX.matchCount - physicalYX.firstWins;
					}

					item.matches = item.firstMatches + item.secondMatches;
					item.matchWins = item.firstWins + item.secondWins;
				}

				stats[`${x}::${y}`] = item;

				top16Total.matches += item.matches;
				top16Total.matchWins += item.matchWins;
				top16Total.firstMatches += item.firstMatches;
				top16Total.firstWins += item.firstWins;
				top16Total.secondMatches += item.secondMatches;
				top16Total.secondWins += item.secondWins;
			}

			// Add row total
			stats[`${x}::TOP16`] = top16Total;
		}

		return {
			format: query.format,
			period: window.period,
			windowStart: run.windowStart,
			windowEndExclusive: run.windowEndExclusive,
			dataEndExclusive: run.dataEndExclusive,
			timezone: "Asia/Shanghai",
			publishedAt: run.publishedAt.toISOString(),
			totalPhysicalMatches,
			candidateUsageDecks,
			decks,
			stats,
		};
	}

	public async getPeriods(format: string): Promise<{ format: string; periods: string[] }> {
		if (format !== "1109") {
			throw new FormatNotSupportedError(format);
		}

		const runs = await this.repository.listRuns(format);
		const periods = Array.from(
			new Set(runs.map((r) => HalfYearWindow.periodFromWindowStart(r.windowStart))),
		).sort((a, b) => b.localeCompare(a));

		return { format, periods };
	}
}
