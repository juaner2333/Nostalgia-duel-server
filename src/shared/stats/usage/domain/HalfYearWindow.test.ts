import { HalfYearWindow } from "./HalfYearWindow";

describe("HalfYearWindow", () => {
	it("parses valid period strings 2026H1 and 2026H2 correctly with reference dates", () => {
		// Past period: finalized to windowEndExclusive
		const h1 = HalfYearWindow.fromPeriodString("2026H1", "2026-09-28");
		expect(h1.period).toBe("2026H1");
		expect(h1.windowStart).toBe("2026-01-01");
		expect(h1.windowEndExclusive).toBe("2026-07-01");
		expect(h1.dataEndExclusive).toBe("2026-07-01");

		// Current ongoing period: dataEndExclusive is capped to today (not windowEndExclusive)
		const h2Ongoing = HalfYearWindow.fromPeriodString("2026H2", "2026-09-28");
		expect(h2Ongoing.period).toBe("2026H2");
		expect(h2Ongoing.windowStart).toBe("2026-07-01");
		expect(h2Ongoing.windowEndExclusive).toBe("2027-01-01");
		expect(h2Ongoing.dataEndExclusive).toBe("2026-09-28");

		// Future reference date: 2026H2 finalized
		const h2Finalized = HalfYearWindow.fromPeriodString("2026H2", "2027-01-15");
		expect(h2Finalized.dataEndExclusive).toBe("2027-01-01");
	});

	it("throws on future period or invalid period strings", () => {
		expect(() => HalfYearWindow.fromPeriodString("2027H1", "2026-09-28")).toThrow(
			"Cannot rebuild future period",
		);
		expect(() => HalfYearWindow.fromPeriodString("2026H3")).toThrow();
		expect(() => HalfYearWindow.fromPeriodString("2026-01")).toThrow();
		expect(() => HalfYearWindow.fromPeriodString("invalid")).toThrow();
	});

	it("resolves current half year window and daily cutoff for given dates", () => {
		// 2026-09-27
		const w1 = HalfYearWindow.current("2026-09-27");
		expect(w1.period).toBe("2026H2");
		expect(w1.windowStart).toBe("2026-07-01");
		expect(w1.windowEndExclusive).toBe("2027-01-01");
		expect(w1.dataEndExclusive).toBe("2026-09-27");

		// 2026-01-01
		const w2 = HalfYearWindow.current("2026-01-01");
		expect(w2.period).toBe("2026H1");
		expect(w2.windowStart).toBe("2026-01-01");
		expect(w2.windowEndExclusive).toBe("2026-07-01");
		expect(w2.dataEndExclusive).toBe("2026-01-01");

		// 2026-07-01
		const w3 = HalfYearWindow.current("2026-07-01");
		expect(w3.period).toBe("2026H2");
		expect(w3.windowStart).toBe("2026-07-01");
		expect(w3.windowEndExclusive).toBe("2027-01-01");
		expect(w3.dataEndExclusive).toBe("2026-07-01");
	});

	it("resolves previous half year window", () => {
		// Previous of 2026H2 is 2026H1
		const prev1 = HalfYearWindow.previousOf("2026H2");
		expect(prev1.period).toBe("2026H1");
		expect(prev1.windowStart).toBe("2026-01-01");
		expect(prev1.windowEndExclusive).toBe("2026-07-01");
		expect(prev1.dataEndExclusive).toBe("2026-07-01");

		// Previous of 2027H1 is 2026H2
		const prev2 = HalfYearWindow.previousOf("2027H1");
		expect(prev2.period).toBe("2026H2");
		expect(prev2.windowStart).toBe("2026-07-01");
		expect(prev2.windowEndExclusive).toBe("2027-01-01");
		expect(prev2.dataEndExclusive).toBe("2027-01-01");
	});

	it("determines period string from windowStart date", () => {
		expect(HalfYearWindow.periodFromWindowStart("2026-01-01")).toBe("2026H1");
		expect(HalfYearWindow.periodFromWindowStart("2026-07-01")).toBe("2026H2");
		expect(() => HalfYearWindow.periodFromWindowStart("2026-02-01")).toThrow();
	});
});
