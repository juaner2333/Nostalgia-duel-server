import {
	GetDeckMatchupStatsUseCase,
	MatchupQueryRepository,
	FormatNotSupportedError,
	StatsNotReadyError,
} from "./GetDeckMatchupStatsUseCase";
import { UsageStatRunData } from "../../usage/domain/UsageConsistencyValidator";
import { DeckMatchupRowData } from "../domain/DeckMatchupCalculator";

describe("GetDeckMatchupStatsUseCase (Task 5.1)", () => {
	class MockMatchupQueryRepository implements MatchupQueryRepository {
		public runs = new Map<string, UsageStatRunData>();
		public deckRows = new Map<string, { deckTypeCode: string; deckCount: number }[]>();
		public matchupRows = new Map<string, DeckMatchupRowData[]>();

		async findRun(formatId: string, windowStart: string): Promise<UsageStatRunData | null> {
			return this.runs.get(`${formatId}:${windowStart}`) ?? null;
		}

		async listRuns(formatId: string): Promise<UsageStatRunData[]> {
			return Array.from(this.runs.values()).filter((r) => r.formatId === formatId);
		}

		async queryTopDecksUsage(
			formatId: string,
			windowStart: string,
		): Promise<{ deckTypeCode: string; deckCount: number }[]> {
			return this.deckRows.get(`${formatId}:${windowStart}`) ?? [];
		}

		async queryMatchupRows(formatId: string, windowStart: string): Promise<DeckMatchupRowData[]> {
			return this.matchupRows.get(`${formatId}:${windowStart}`) ?? [];
		}
	}

	let repo: MockMatchupQueryRepository;
	let useCase: GetDeckMatchupStatsUseCase;

	beforeEach(() => {
		repo = new MockMatchupQueryRepository();
		useCase = new GetDeckMatchupStatsUseCase(repo);
	});

	it("rejects non-1109 format with FormatNotSupportedError", async () => {
		await expect(useCase.execute({ format: "1103" })).rejects.toThrow(FormatNotSupportedError);
		await expect(useCase.getPeriods("1103")).rejects.toThrow(FormatNotSupportedError);
	});

	it("throws StatsNotReadyError when usage_stat_runs batch does not exist", async () => {
		await expect(useCase.execute({ format: "1109", period: "2026H1" })).rejects.toThrow(
			StatsNotReadyError,
		);
	});

	it("returns zero-sample empty matrix when batch exists but matchup table has zero rows", async () => {
		const windowStart = "2026-07-01";
		repo.runs.set("1109:2026-07-01", {
			formatId: "1109",
			windowStart,
			windowEndExclusive: "2027-01-01",
			dataEndExclusive: "2026-09-28",
			totalDecks: 0,
			sideKnownDecks: 0,
			publishedAt: new Date("2026-09-28T03:00:00Z"),
		});

		const res = await useCase.execute({ format: "1109", period: "2026H2" });
		expect(res.format).toBe("1109");
		expect(res.period).toBe("2026H2");
		expect(res.totalPhysicalMatches).toBe(0);
		expect(res.decks).toEqual([]);
		expect(res.stats).toEqual({});
	});

	it("computes six integer counts for A/B, B/A opposing directions, and mirror A/A", async () => {
		const windowStart = "2026-07-01";
		repo.runs.set("1109:2026-07-01", {
			formatId: "1109",
			windowStart,
			windowEndExclusive: "2027-01-01",
			dataEndExclusive: "2026-09-28",
			totalDecks: 100,
			sideKnownDecks: 90,
			publishedAt: new Date("2026-09-28T03:00:00Z"),
		});

		repo.deckRows.set("1109:2026-07-01", [
			{ deckTypeCode: "HERO_BEAT", deckCount: 60 },
			{ deckTypeCode: "SIX_SAMURAI", deckCount: 40 },
			{ deckTypeCode: "OTHERS", deckCount: 10 }, // Must be excluded from top 15
		]);

		repo.matchupRows.set("1109:2026-07-01", [
			// HERO first vs SIX: 50 matches, HERO won 30
			{
				formatId: "1109",
				windowStart,
				firstDeckCode: "HERO_BEAT",
				secondDeckCode: "SIX_SAMURAI",
				matchCount: 50,
				firstWins: 30,
			},
			// SIX first vs HERO: 20 matches, SIX won 12 (so HERO won 8 as second)
			{
				formatId: "1109",
				windowStart,
				firstDeckCode: "SIX_SAMURAI",
				secondDeckCode: "HERO_BEAT",
				matchCount: 20,
				firstWins: 12,
			},
			// HERO vs HERO mirror: 10 physical matches, G1 first won 6
			{
				formatId: "1109",
				windowStart,
				firstDeckCode: "HERO_BEAT",
				secondDeckCode: "HERO_BEAT",
				matchCount: 10,
				firstWins: 6,
			},
		]);

		const res = await useCase.execute({ format: "1109", period: "2026H2" });

		expect(res.totalPhysicalMatches).toBe(80); // 50 + 20 + 10
		expect(res.decks).toHaveLength(2);
		expect(res.decks.map((d) => d.code)).toEqual(["HERO_BEAT", "SIX_SAMURAI"]);

		// 1. HERO vs SIX
		const heroVsSix = res.stats["HERO_BEAT::SIX_SAMURAI"];
		expect(heroVsSix).toEqual({
			matches: 70, // 50 + 20
			matchWins: 38, // 30 (as first) + 8 (as second)
			firstMatches: 50,
			firstWins: 30,
			secondMatches: 20,
			secondWins: 8, // 20 - 12
		});

		// 2. SIX vs HERO (opposite direction)
		const sixVsHero = res.stats["SIX_SAMURAI::HERO_BEAT"];
		expect(sixVsHero).toEqual({
			matches: 70,
			matchWins: 32, // 12 (as first) + 20 (as second)
			firstMatches: 20,
			firstWins: 12,
			secondMatches: 50,
			secondWins: 20, // 50 - 30
		});

		// Check complementary win counts: 38 + 32 = 70
		expect(heroVsSix.matchWins + sixVsHero.matchWins).toBe(70);

		// 3. HERO vs HERO (mirror match)
		const heroMirror = res.stats["HERO_BEAT::HERO_BEAT"];
		expect(heroMirror).toEqual({
			matches: 20, // 2 * 10
			matchWins: 10, // 10
			firstMatches: 10,
			firstWins: 6,
			secondMatches: 10,
			secondWins: 4, // 10 - 6
		});

		// 4. SIX vs SIX (zero sample mirror match)
		const sixMirror = res.stats["SIX_SAMURAI::SIX_SAMURAI"];
		expect(sixMirror).toEqual({
			matches: 0,
			matchWins: 0,
			firstMatches: 0,
			firstWins: 0,
			secondMatches: 0,
			secondWins: 0,
		});

		// 5. TOP15 Row Total for HERO_BEAT
		// Against SIX: 70 matches, 38 wins (first 50/30, second 20/8)
		// Against HERO: 20 matches, 10 wins (first 10/6, second 10/4)
		const heroTop15 = res.stats["HERO_BEAT::TOP15"];
		expect(heroTop15).toEqual({
			matches: 90,
			matchWins: 48,
			firstMatches: 60,
			firstWins: 36,
			secondMatches: 30,
			secondWins: 12,
		});

		// 6. TOP15 Row Total for SIX_SAMURAI
		// Against HERO: 70 matches, 32 wins (first 20/12, second 50/20)
		// Against SIX: 0 matches, 0 wins
		const sixTop15 = res.stats["SIX_SAMURAI::TOP15"];
		expect(sixTop15).toEqual({
			matches: 70,
			matchWins: 32,
			firstMatches: 20,
			firstWins: 12,
			secondMatches: 50,
			secondWins: 20,
		});
	});

	it("lists published periods sorted descending", async () => {
		repo.runs.set("1109:2026-01-01", {
			formatId: "1109",
			windowStart: "2026-01-01",
			windowEndExclusive: "2026-07-01",
			dataEndExclusive: "2026-07-01",
			totalDecks: 10,
			sideKnownDecks: 10,
			publishedAt: new Date("2026-07-01T03:00:00Z"),
		});
		repo.runs.set("1109:2026-07-01", {
			formatId: "1109",
			windowStart: "2026-07-01",
			windowEndExclusive: "2027-01-01",
			dataEndExclusive: "2026-09-28",
			totalDecks: 20,
			sideKnownDecks: 20,
			publishedAt: new Date("2026-09-28T03:00:00Z"),
		});

		const result = await useCase.getPeriods("1109");
		expect(result).toEqual({
			format: "1109",
			periods: ["2026H2", "2026H1"],
		});
	});
});
