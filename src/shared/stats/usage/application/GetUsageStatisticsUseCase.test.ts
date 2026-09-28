import { GetUsageStatisticsUseCase, UsageQueryRepository } from "./GetUsageStatisticsUseCase";
import { CdbCardMetadataProvider } from "../infrastructure/cdb/CdbCardMetadataProvider";
import { CardTypes } from "@shared/card/domain/CardTypes";

describe("GetUsageStatisticsUseCase", () => {
	class MockUsageQueryRepository implements UsageQueryRepository {
		public runs = new Map<string, any>();
		public decks = new Map<string, any[]>();
		public cards = new Map<string, any[]>();

		async findRun(formatId: string, windowStart: string) {
			return this.runs.get(`${formatId}:${windowStart}`) ?? null;
		}

		async listRuns(formatId: string) {
			return Array.from(this.runs.values())
				.filter((r) => r.formatId === formatId)
				.sort((a, b) => b.windowStart.localeCompare(a.windowStart));
		}

		async queryDecks(formatId: string, windowStart: string, limit: number, offset: number) {
			const all = this.decks.get(`${formatId}:${windowStart}`) ?? [];
			return {
				total: all.length,
				rows: all.slice(offset, offset + limit),
			};
		}

		async queryCards(
			formatId: string,
			windowStart: string,
			metric: string,
			limit: number,
			offset: number,
		) {
			const all = (this.cards.get(`${formatId}:${windowStart}`) ?? []).filter(
				(c) => c.metric === metric,
			);
			return {
				total: all.length,
				rows: all.slice(offset, offset + limit),
			};
		}

		async querySnapshot(
			formatId: string,
			windowStart: string,
			metric: string,
			limit: number,
			offset: number,
		) {
			const run = await this.findRun(formatId, windowStart);
			if (!run) {
				return { run: null, total: 0 };
			}
			if (metric === "deck") {
				const { total, rows } = await this.queryDecks(formatId, windowStart, limit, offset);
				return { run, total, deckRows: rows };
			}
			const { total, rows } = await this.queryCards(formatId, windowStart, metric, limit, offset);
			return { run, total, cardRows: rows };
		}
	}

	const mockCdb = {
		load: async () => undefined,
		getCardMetadata: (id: number) => {
			if (id === 101) return { id: 101, alias: 0, type: CardTypes.TYPE_MONSTER, name: "Card 101" };
			if (id === 102) return { id: 102, alias: 0, type: CardTypes.TYPE_MONSTER, name: "Card 102" };
			return undefined;
		},
		getCanonicalCardId: (id: number) => id,
		hasCard: (id: number) => id === 101 || id === 102,
	} as unknown as CdbCardMetadataProvider;

	it("returns available periods in descending order", async () => {
		const repo = new MockUsageQueryRepository();
		repo.runs.set("1109:2026-01-01", {
			formatId: "1109",
			windowStart: "2026-01-01",
			windowEndExclusive: "2026-07-01",
			dataEndExclusive: "2026-07-01",
			totalDecks: 50,
			sideKnownDecks: 40,
			publishedAt: new Date("2026-07-01T10:00:00Z"),
		});
		repo.runs.set("1109:2026-07-01", {
			formatId: "1109",
			windowStart: "2026-07-01",
			windowEndExclusive: "2027-01-01",
			dataEndExclusive: "2026-09-27",
			totalDecks: 100,
			sideKnownDecks: 80,
			publishedAt: new Date("2026-09-27T10:00:00Z"),
		});

		const useCase = new GetUsageStatisticsUseCase(repo, mockCdb);
		const result = await useCase.getPeriods("1109");

		expect(result.format).toBe("1109");
		expect(result.periods).toHaveLength(2);
		expect(result.periods[0].period).toBe("2026H2");
		expect(result.periods[0].isFinalized).toBe(false);
		expect(result.periods[1].period).toBe("2026H1");
		expect(result.periods[1].isFinalized).toBe(true);
	});

	it("queries deck usage with correct denominator and 0-1 usage rate", async () => {
		const repo = new MockUsageQueryRepository();
		repo.runs.set("1109:2026-07-01", {
			formatId: "1109",
			windowStart: "2026-07-01",
			windowEndExclusive: "2027-01-01",
			dataEndExclusive: "2026-09-27",
			totalDecks: 100,
			sideKnownDecks: 80,
			publishedAt: new Date(),
		});
		repo.decks.set("1109:2026-07-01", [
			{ deckTypeCode: "D01", deckCount: 40 },
			{ deckTypeCode: "D02", deckCount: 30 },
		]);

		const useCase = new GetUsageStatisticsUseCase(repo, mockCdb);
		const res = await useCase.getUsage({
			format: "1109",
			metric: "deck",
			period: "2026H2",
			page: 1,
			pageSize: 50,
		});

		expect(res.format).toBe("1109");
		expect(res.metric).toBe("deck");
		expect(res.denominator).toBe(100);
		expect(res.decks).toHaveLength(2);
		expect(res.decks![0].rank).toBe(1);
		expect(res.decks![0].code).toBe("D01");
		expect(res.decks![0].nameZh).toBe("代行天使");
		expect(res.decks![0].deckCount).toBe(40);
		expect(res.decks![0].usageRate).toBe(0.4);
	});

	it("queries card usage with cross-page ranking and sideKnownDecks for side metric", async () => {
		const repo = new MockUsageQueryRepository();
		repo.runs.set("1109:2026-07-01", {
			formatId: "1109",
			windowStart: "2026-07-01",
			windowEndExclusive: "2027-01-01",
			dataEndExclusive: "2026-09-27",
			totalDecks: 100,
			sideKnownDecks: 50,
			publishedAt: new Date(),
		});
		repo.cards.set("1109:2026-07-01", [
			{ metric: "side", cardId: 101, deckCount: 25, copies1: 10, copies2: 10, copies3: 5 },
			{ metric: "side", cardId: 102, deckCount: 15, copies1: 5, copies2: 5, copies3: 5 },
		]);

		const useCase = new GetUsageStatisticsUseCase(repo, mockCdb);
		// Page 2, pageSize 1
		const res = await useCase.getUsage({
			format: "1109",
			metric: "side",
			period: "2026H2",
			page: 2,
			pageSize: 1,
		});

		expect(res.denominator).toBe(50); // sideKnownDecks used for side
		expect(res.cards).toHaveLength(1);
		expect(res.cards![0].rank).toBe(2); // Page 2 offset
		expect(res.cards![0].cardId).toBe(102);
		expect(res.cards![0].name).toBe("Card 102");
		expect(res.cards![0].deckCount).toBe(15);
		expect(res.cards![0].usageRate).toBe(0.3);
	});

	it("returns null usageRate when denominator is 0", async () => {
		const repo = new MockUsageQueryRepository();
		repo.runs.set("1109:2026-07-01", {
			formatId: "1109",
			windowStart: "2026-07-01",
			windowEndExclusive: "2027-01-01",
			dataEndExclusive: "2026-09-27",
			totalDecks: 0,
			sideKnownDecks: 0,
			publishedAt: new Date(),
		});

		const useCase = new GetUsageStatisticsUseCase(repo, mockCdb);
		const res = await useCase.getUsage({
			format: "1109",
			metric: "deck",
			period: "2026H2",
		});

		expect(res.denominator).toBe(0);
		expect(res.decks).toHaveLength(0);
	});

	it("throws error for unsupported format or unpublished period", async () => {
		const repo = new MockUsageQueryRepository();
		const useCase = new GetUsageStatisticsUseCase(repo, mockCdb);

		// Format not supported
		await expect(useCase.getUsage({ format: "9999", metric: "deck" })).rejects.toThrow(
			/Unsupported format/i,
		);

		// Period not published
		await expect(
			useCase.getUsage({ format: "1109", metric: "deck", period: "2025H1" }),
		).rejects.toThrow(/not found|not ready/i);
	});
});
