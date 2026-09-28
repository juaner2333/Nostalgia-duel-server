import {
	calculateBeijingHalfYear,
	calculateBeijingSeason,
	formatBeijingSeasonString,
	parseHalfYearSeason,
} from "./calculateBeijingSeason";

describe("calculateBeijingSeason", () => {
	it("calculates correct YYYYMM integer for given Date in Asia/Shanghai", () => {
		const d1 = new Date("2026-06-30T15:59:59Z"); // 23:59:59 Beijing
		const d2 = new Date("2026-06-30T16:00:00Z"); // 00:00:00 Beijing July 1
		expect(calculateBeijingSeason(d1)).toBe(202606);
		expect(calculateBeijingSeason(d2)).toBe(202607);
	});

	it("formats season string as YYYY-MM in Asia/Shanghai", () => {
		const d = new Date("2026-07-01T00:00:00+08:00");
		expect(formatBeijingSeasonString(d)).toBe("2026-07");
	});
});

describe("calculateBeijingHalfYear", () => {
	it("classifies June 30 23:59:59 as H1 and July 1 00:00:00 as H2", () => {
		const juneEnd = new Date("2026-06-30T23:59:59+08:00");
		const julyStart = new Date("2026-07-01T00:00:00+08:00");

		const h1 = calculateBeijingHalfYear(juneEnd);
		expect(h1.year).toBe(2026);
		expect(h1.half).toBe(1);
		expect(h1.label).toBe("2026H1");
		expect(h1.startMonth).toBe(202601);
		expect(h1.endMonth).toBe(202606);
		expect(h1.months).toEqual([202601, 202602, 202603, 202604, 202605, 202606]);

		const h2 = calculateBeijingHalfYear(julyStart);
		expect(h2.year).toBe(2026);
		expect(h2.half).toBe(2);
		expect(h2.label).toBe("2026H2");
		expect(h2.startMonth).toBe(202607);
		expect(h2.endMonth).toBe(202612);
		expect(h2.months).toEqual([202607, 202608, 202609, 202610, 202611, 202612]);
	});

	it("classifies December 31 23:59:59 as H2 and January 1 00:00:00 as next year H1", () => {
		const decEnd = new Date("2026-12-31T23:59:59+08:00");
		const janStart = new Date("2027-01-01T00:00:00+08:00");

		expect(calculateBeijingHalfYear(decEnd).label).toBe("2026H2");
		expect(calculateBeijingHalfYear(janStart).label).toBe("2027H1");
	});

	it("maintains same half year across months within the half year", () => {
		const aprilDate = new Date("2026-04-15T12:00:00+08:00");
		const mayDate = new Date("2026-05-15T12:00:00+08:00");

		const resApril = calculateBeijingHalfYear(aprilDate);
		const resMay = calculateBeijingHalfYear(mayDate);

		expect(resApril.label).toBe("2026H1");
		expect(resMay.label).toBe("2026H1");
		expect(resApril.months).toEqual(resMay.months);
	});
});

describe("parseHalfYearSeason", () => {
	it("parses valid YYYYH1 and YYYYH2 labels strictly", () => {
		const h1 = parseHalfYearSeason("2026H1");
		expect(h1).toEqual({
			year: 2026,
			half: 1,
			label: "2026H1",
			startMonth: 202601,
			endMonth: 202606,
			months: [202601, 202602, 202603, 202604, 202605, 202606],
		});

		const h2 = parseHalfYearSeason("2026H2");
		expect(h2).toEqual({
			year: 2026,
			half: 2,
			label: "2026H2",
			startMonth: 202607,
			endMonth: 202612,
			months: [202607, 202608, 202609, 202610, 202611, 202612],
		});
	});

	it("rejects invalid half-year expressions and legacy monthly format", () => {
		expect(() => parseHalfYearSeason("2026-06")).toThrow(
			"Invalid season: format must be YYYYH1 or YYYYH2",
		);
		expect(() => parseHalfYearSeason("2026-09")).toThrow(
			"Invalid season: format must be YYYYH1 or YYYYH2",
		);
		expect(() => parseHalfYearSeason("2026H0")).toThrow(
			"Invalid season: format must be YYYYH1 or YYYYH2",
		);
		expect(() => parseHalfYearSeason("2026H3")).toThrow(
			"Invalid season: format must be YYYYH1 or YYYYH2",
		);
		expect(() => parseHalfYearSeason("2026")).toThrow(
			"Invalid season: format must be YYYYH1 or YYYYH2",
		);
		expect(() => parseHalfYearSeason("invalid")).toThrow(
			"Invalid season: format must be YYYYH1 or YYYYH2",
		);
		expect(() => parseHalfYearSeason("")).toThrow(
			"Invalid season: format must be YYYYH1 or YYYYH2",
		);
	});
});
