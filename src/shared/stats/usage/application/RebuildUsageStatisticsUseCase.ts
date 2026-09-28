import { CardUsageCalculator, CardUsageRow } from "../domain/CardUsageCalculator";
import { DeckUsageCalculator, PlayerMatchDeckSnapshot } from "../domain/DeckUsageCalculator";
import { HalfYearWindow } from "../domain/HalfYearWindow";
import {
	UsageConsistencyValidator,
	UsageDeckRowData,
	UsageStatRunData,
} from "../domain/UsageConsistencyValidator";
import { CdbCardMetadataProvider } from "../infrastructure/cdb/CdbCardMetadataProvider";

export interface UsageStatisticsRepository {
	tryAcquireAdvisoryLock(formatId: string): Promise<boolean>;
	releaseAdvisoryLock(formatId: string): Promise<void>;
	streamValidSnapshots(
		formatId: string,
		startInclusive: string,
		endExclusive: string,
		batchSize?: number,
	): AsyncIterable<PlayerMatchDeckSnapshot>;
	findRun(formatId: string, windowStart: string): Promise<UsageStatRunData | null>;
	listPublishedRuns(formatId: string): Promise<UsageStatRunData[]>;
	publishPeriodStatistics(
		run: UsageStatRunData,
		deckRows: readonly UsageDeckRowData[],
		cardRows: readonly CardUsageRow[],
	): Promise<void>;
}

export interface RebuildResult {
	readonly success: boolean;
	readonly formatId: string;
	readonly windowStart: string;
	readonly dataEndExclusive: string;
	readonly totalDecks?: number;
	readonly sideKnownDecks?: number;
	readonly durationMs?: number;
	readonly error?: string;
}

export interface RebuildReport {
	readonly success: boolean;
	readonly formatReports: readonly RebuildResult[];
}

export class RebuildUsageStatisticsUseCase {
	constructor(
		private readonly repository: UsageStatisticsRepository,
		private readonly metadataProvider: CdbCardMetadataProvider,
	) {}

	public async rebuildFormatWindow(
		formatId: string,
		window: HalfYearWindow,
	): Promise<RebuildResult> {
		const startTime = Date.now();
		const locked = await this.repository.tryAcquireAdvisoryLock(formatId);
		if (!locked) {
			return {
				success: false,
				formatId,
				windowStart: window.windowStart,
				dataEndExclusive: window.dataEndExclusive,
				error: `Could not acquire advisory lock for format ${formatId}`,
			};
		}

		try {
			// 1. Collect all snapshots in the window [window.windowStart, window.dataEndExclusive)
			const snapshots: PlayerMatchDeckSnapshot[] = [];
			for await (const snapshot of this.repository.streamValidSnapshots(
				formatId,
				window.windowStart,
				window.dataEndExclusive,
			)) {
				snapshots.push(snapshot);
			}

			// 2. Deck usage calculation
			const deckCalculator = new DeckUsageCalculator(formatId, (id) =>
				this.metadataProvider.hasCard(id),
			);
			const deckResult = deckCalculator.calculate(snapshots);

			const deckRows: UsageDeckRowData[] = [];
			for (const [code, count] of deckResult.deckCounts.entries()) {
				deckRows.push({
					formatId,
					windowStart: window.windowStart,
					deckTypeCode: code,
					deckCount: count,
				});
			}

			// 3. Card usage calculation
			const cardCalculator = new CardUsageCalculator(
				this.metadataProvider,
				formatId,
				window.windowStart,
			);
			const cardRows = cardCalculator.calculate(deckResult.validSnapshots);

			// 4. Header run data
			const runData: UsageStatRunData = {
				formatId,
				windowStart: window.windowStart,
				windowEndExclusive: window.windowEndExclusive,
				dataEndExclusive: window.dataEndExclusive,
				totalDecks: deckResult.totalDecks,
				sideKnownDecks: deckResult.sideKnownDecks,
				publishedAt: new Date(),
			};

			// 5. Pre-publish validation
			UsageConsistencyValidator.validate(runData, deckRows, cardRows, this.metadataProvider);

			// 6. Atomic publish
			await this.repository.publishPeriodStatistics(runData, deckRows, cardRows);

			return {
				success: true,
				formatId,
				windowStart: window.windowStart,
				dataEndExclusive: window.dataEndExclusive,
				totalDecks: deckResult.totalDecks,
				sideKnownDecks: deckResult.sideKnownDecks,
				durationMs: Date.now() - startTime,
			};
		} catch (error) {
			return {
				success: false,
				formatId,
				windowStart: window.windowStart,
				dataEndExclusive: window.dataEndExclusive,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			await this.repository.releaseAdvisoryLock(formatId);
		}
	}

	public async rebuildDaily(referenceDate?: string | Date): Promise<RebuildReport> {
		try {
			await this.metadataProvider.load();
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				formatReports: [
					{
						success: false,
						formatId: "1103",
						windowStart: "",
						dataEndExclusive: "",
						totalDecks: 0,
						sideKnownDecks: 0,
						durationMs: 0,
						error: errMsg,
					},
					{
						success: false,
						formatId: "1109",
						windowStart: "",
						dataEndExclusive: "",
						totalDecks: 0,
						sideKnownDecks: 0,
						durationMs: 0,
						error: errMsg,
					},
				],
			};
		}

		const currentWindow = HalfYearWindow.current(referenceDate);
		const formats = ["1103", "1109"];
		const results: RebuildResult[] = [];

		for (const formatId of formats) {
			// Catch up previous half-year if needed
			const prevWindow = HalfYearWindow.previousOf(currentWindow.period);
			const prevRun = await this.repository.findRun(formatId, prevWindow.windowStart);
			if (!prevRun || prevRun.dataEndExclusive < prevWindow.windowEndExclusive) {
				const prevResult = await this.rebuildFormatWindow(formatId, prevWindow);
				results.push(prevResult);
			}

			// Rebuild current half-year
			const currentResult = await this.rebuildFormatWindow(formatId, currentWindow);
			results.push(currentResult);
		}

		const success = results.every((r) => r.success);
		return { success, formatReports: results };
	}

	public async rebuildPeriod(
		periodStr: string,
		referenceDate?: string | Date,
	): Promise<RebuildReport> {
		try {
			await this.metadataProvider.load();
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				formatReports: [
					{
						success: false,
						formatId: "1103",
						windowStart: "",
						dataEndExclusive: "",
						totalDecks: 0,
						sideKnownDecks: 0,
						durationMs: 0,
						error: errMsg,
					},
					{
						success: false,
						formatId: "1109",
						windowStart: "",
						dataEndExclusive: "",
						totalDecks: 0,
						sideKnownDecks: 0,
						durationMs: 0,
						error: errMsg,
					},
				],
			};
		}

		const window = HalfYearWindow.fromPeriodString(periodStr, referenceDate);
		const formats = ["1103", "1109"];
		const results: RebuildResult[] = [];

		for (const formatId of formats) {
			const res = await this.rebuildFormatWindow(formatId, window);
			results.push(res);
		}

		const success = results.every((r) => r.success);
		return { success, formatReports: results };
	}
}
