import {
	RebuildUsageStatisticsUseCase,
	UsageStatisticsRepository,
} from "./RebuildUsageStatisticsUseCase";
import { UsageStatRunData, UsageDeckRowData } from "../domain/UsageConsistencyValidator";
import { CardUsageRow } from "../domain/CardUsageCalculator";
import { PlayerMatchDeckSnapshot } from "../domain/DeckUsageCalculator";
import { HalfYearWindow } from "../domain/HalfYearWindow";
import { CdbCardMetadataProvider } from "../infrastructure/cdb/CdbCardMetadataProvider";
import { CardTypes } from "@shared/card/domain/CardTypes";
import {
	DeckMatchupRowData,
	RawPhysicalMatchPerspective,
} from "@shared/stats/matchup/domain/DeckMatchupCalculator";

describe("RebuildUsageStatisticsUseCase", () => {
	class MockUsageRepository implements UsageStatisticsRepository {
		public runs = new Map<string, UsageStatRunData>(); // key: `${formatId}:${windowStart}`
		public deckRows = new Map<string, UsageDeckRowData[]>();
		public cardRows = new Map<string, CardUsageRow[]>();
		public snapshots: PlayerMatchDeckSnapshot[] = [];
		public lockedFormats = new Set<string>();

		async tryAcquireAdvisoryLock(formatId: string): Promise<boolean> {
			if (this.lockedFormats.has(formatId)) return false;
			this.lockedFormats.add(formatId);
			return true;
		}

		async releaseAdvisoryLock(formatId: string): Promise<void> {
			this.lockedFormats.delete(formatId);
		}

		async *streamValidSnapshots(
			formatId: string,
			_start: string,
			_end: string,
			_batchSize = 500,
		): AsyncIterable<PlayerMatchDeckSnapshot> {
			for (const s of this.snapshots) {
				if (s.formatId === formatId) {
					yield s;
				}
			}
		}

		async findRun(formatId: string, windowStart: string): Promise<UsageStatRunData | null> {
			return this.runs.get(`${formatId}:${windowStart}`) ?? null;
		}

		async listPublishedRuns(formatId: string): Promise<UsageStatRunData[]> {
			return Array.from(this.runs.values()).filter((r) => r.formatId === formatId);
		}

		public matchupRows = new Map<string, DeckMatchupRowData[]>();
		public perspectives: RawPhysicalMatchPerspective[] = [];
		public matchupExists = new Map<string, boolean>();

		async queryPhysicalMatchPerspectives(
			formatId: string,
			_start: string,
			_end: string,
		): Promise<RawPhysicalMatchPerspective[]> {
			return this.perspectives.filter((p) => p.formatId === formatId);
		}

		async hasMatchupData(formatId: string, windowStart: string): Promise<boolean> {
			return (
				this.matchupExists.get(`${formatId}:${windowStart}`) ??
				(this.matchupRows.get(`${formatId}:${windowStart}`)?.length ?? 0) > 0
			);
		}

		async publishPeriodStatistics(
			run: UsageStatRunData,
			deckRows: readonly UsageDeckRowData[],
			cardRows: readonly CardUsageRow[],
			matchupRows?: readonly DeckMatchupRowData[],
		): Promise<void> {
			const key = `${run.formatId}:${run.windowStart}`;
			this.runs.set(key, run);
			this.deckRows.set(key, [...deckRows]);
			this.cardRows.set(key, [...cardRows]);
			if (matchupRows) {
				this.matchupRows.set(key, [...matchupRows]);
			}
		}
	}

	const mockCdbProvider = {
		load: async () => undefined,
		getCardMetadata: (id: number) => {
			if (id === 101) return { id: 101, alias: 0, type: CardTypes.TYPE_MONSTER, name: "Monster 1" };
			return undefined;
		},
		getCanonicalCardId: (id: number) => id,
		hasCard: (id: number) => id === 101,
	} as unknown as CdbCardMetadataProvider;

	it("rebuilds current window and publishes atomic summary for format", async () => {
		const repo = new MockUsageRepository();
		repo.snapshots = [
			{
				matchId: "m1",
				formatId: "1109",
				deckTypeCode: "D01",
				mainCards: [101, ...Array(39).fill(101)],
				extraCards: [],
				sideCards: [],
			},
		];

		const useCase = new RebuildUsageStatisticsUseCase(repo, mockCdbProvider);
		const window = HalfYearWindow.current("2026-09-27");
		const result = await useCase.rebuildFormatWindow("1109", window);

		expect(result.success).toBe(true);
		expect(result.totalDecks).toBe(1);
		expect(result.sideKnownDecks).toBe(1);

		const run = await repo.findRun("1109", "2026-07-01");
		expect(run).toBeDefined();
		expect(run?.totalDecks).toBe(1);
		expect(run?.dataEndExclusive).toBe("2026-09-27");
	});

	it("replaces existing period cleanly without accumulating counts", async () => {
		const repo = new MockUsageRepository();
		repo.snapshots = [
			{
				matchId: "m1",
				formatId: "1109",
				deckTypeCode: "D01",
				mainCards: Array(40).fill(101),
				extraCards: [],
				sideCards: [],
			},
		];

		const useCase = new RebuildUsageStatisticsUseCase(repo, mockCdbProvider);
		const window = HalfYearWindow.current("2026-09-27");

		// Run 1
		await useCase.rebuildFormatWindow("1109", window);
		// Run 2 (same data)
		await useCase.rebuildFormatWindow("1109", window);

		const run = await repo.findRun("1109", "2026-07-01");
		expect(run?.totalDecks).toBe(1); // not 2
		const deckRows = repo.deckRows.get("1109:2026-07-01");
		expect(deckRows).toHaveLength(1);
		expect(deckRows![0].deckCount).toBe(1);
	});

	it("fails and preserves existing data when lock cannot be acquired", async () => {
		const repo = new MockUsageRepository();
		repo.lockedFormats.add("1109"); // Already locked

		const useCase = new RebuildUsageStatisticsUseCase(repo, mockCdbProvider);
		const window = HalfYearWindow.current("2026-09-27");
		const result = await useCase.rebuildFormatWindow("1109", window);

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/lock/i);
	});

	it("publishes zero-denominator result when no snapshots exist", async () => {
		const repo = new MockUsageRepository();
		repo.snapshots = []; // empty

		const useCase = new RebuildUsageStatisticsUseCase(repo, mockCdbProvider);
		const window = HalfYearWindow.current("2026-09-27");
		const result = await useCase.rebuildFormatWindow("1109", window);

		expect(result.success).toBe(true);
		expect(result.totalDecks).toBe(0);
		expect(result.sideKnownDecks).toBe(0);

		const run = await repo.findRun("1109", "2026-07-01");
		expect(run?.totalDecks).toBe(0);
		expect(run?.sideKnownDecks).toBe(0);
	});

	it("processes both environments independently and catches up previous unfinalized half-year", async () => {
		const repo = new MockUsageRepository();
		// Format 1103 has 1 snapshot
		repo.snapshots = [
			{
				matchId: "m-1103-1",
				formatId: "1103",
				deckTypeCode: "OTHERS",
				mainCards: Array(40).fill(101),
				extraCards: [],
				sideCards: null,
			},
		];

		const useCase = new RebuildUsageStatisticsUseCase(repo, mockCdbProvider);
		// Assume today is 2026-07-05 (start of H2, previous H1 unfinalized)
		const report = await useCase.rebuildDaily("2026-07-05");

		expect(report.success).toBe(true);
		expect(report.formatReports.length).toBeGreaterThanOrEqual(2);

		// Both 1103 and 1109 were attempted
		const f1103 = report.formatReports.filter((r) => r.formatId === "1103");
		const f1109 = report.formatReports.filter((r) => r.formatId === "1109");
		expect(f1103.length).toBeGreaterThan(0);
		expect(f1109.length).toBeGreaterThan(0);
	});

	it("fails and preserves existing records when CDB metadata provider fails to load", async () => {
		const repo = new MockUsageRepository();
		const failingCdbProvider = {
			load: async () => {
				throw new Error("Fixed cards.cdb not found at resolved path: /broken/path/cards.cdb");
			},
			getCardMetadata: () => undefined,
			getCanonicalCardId: (id: number) => id,
			hasCard: () => false,
		} as unknown as CdbCardMetadataProvider;

		const useCase = new RebuildUsageStatisticsUseCase(repo, failingCdbProvider);
		const publishSpy = jest.spyOn(repo, "publishPeriodStatistics");

		const result = await useCase.rebuildPeriod("2026H1");
		expect(result.success).toBe(false);
		expect(publishSpy).not.toHaveBeenCalled();
	});

	it("rebuilds 1109 window, selects Top 15, calculates matchups, and publishes atomic matchup rows", async () => {
		const repo = new MockUsageRepository();
		repo.snapshots = [
			{
				matchId: "m1",
				formatId: "1109",
				deckTypeCode: "D01",
				mainCards: Array(40).fill(101),
				extraCards: [],
				sideCards: [],
			},
			{
				matchId: "m2",
				formatId: "1109",
				deckTypeCode: "D02",
				mainCards: Array(40).fill(101),
				extraCards: [],
				sideCards: [],
			},
		];
		repo.perspectives = [
			{
				gameId: "game-101",
				matchId: "m1",
				userId: "u1",
				formatId: "1109",
				winner: true,
				playerScore: 2,
				opponentScore: 0,
				isAnnulled: false,
				isDeleted: false,
				deckTypeCode: "D01",
				g1IsFirst: true,
			},
			{
				gameId: "game-101",
				matchId: "m2",
				userId: "u2",
				formatId: "1109",
				winner: false,
				playerScore: 0,
				opponentScore: 2,
				isAnnulled: false,
				isDeleted: false,
				deckTypeCode: "D02",
				g1IsFirst: false,
			},
		];

		const useCase = new RebuildUsageStatisticsUseCase(repo, mockCdbProvider);
		const window = HalfYearWindow.current("2026-09-27");
		const result = await useCase.rebuildFormatWindow("1109", window);

		expect(result.success).toBe(true);
		expect(result.admittedPhysicalMatches).toBe(1);

		const matchupRows = repo.matchupRows.get("1109:2026-07-01");
		expect(matchupRows).toBeDefined();
		expect(matchupRows).toHaveLength(1);
		expect(matchupRows![0]).toEqual({
			formatId: "1109",
			windowStart: "2026-07-01",
			firstDeckCode: "D01",
			secondDeckCode: "D02",
			matchCount: 1,
			firstWins: 1,
		});
	});

	it("catches up previous 1109 half-year when usage was finalized but matchup table is missing", async () => {
		const repo = new MockUsageRepository();
		const prevWindow = HalfYearWindow.previousOf("2026H2"); // 2026H1
		// Finalized run for 2026H1
		repo.runs.set("1109:2026-01-01", {
			formatId: "1109",
			windowStart: "2026-01-01",
			windowEndExclusive: "2026-07-01",
			dataEndExclusive: "2026-07-01",
			totalDecks: 10,
			sideKnownDecks: 10,
			publishedAt: new Date("2026-07-01T03:00:00Z"),
		});
		// But hasMatchupData is false for 2026H1!
		repo.matchupExists.set("1109:2026-01-01", false);

		const useCase = new RebuildUsageStatisticsUseCase(repo, mockCdbProvider);
		const report = await useCase.rebuildDaily("2026-07-05");

		expect(report.success).toBe(true);
		// 1109 caught up 2026H1 because matchup was missing
		const f1109Reports = report.formatReports.filter((r) => r.formatId === "1109");
		expect(f1109Reports.some((r) => r.windowStart === "2026-01-01")).toBe(true);
	});
});
