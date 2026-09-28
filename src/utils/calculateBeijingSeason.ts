export function calculateBeijingSeason(date: Date): number {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
	});
	// formatted parts: [{type: 'year', value: 'YYYY'}, {type: 'literal', value: '-'}, {type: 'month', value: 'MM'}]
	const parts = formatter.formatToParts(date);
	const year = parts.find((p) => p.type === "year")?.value ?? "1970";
	const month = parts.find((p) => p.type === "month")?.value ?? "01";
	return parseInt(`${year}${month}`, 10);
}

export function formatBeijingSeasonString(date: Date): string {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
	});
	const parts = formatter.formatToParts(date);
	const year = parts.find((p) => p.type === "year")?.value ?? "1970";
	const month = parts.find((p) => p.type === "month")?.value ?? "01";
	return `${year}-${month}`;
}

export interface BeijingHalfYearSeason {
	year: number;
	half: 1 | 2;
	label: string;
	startMonth: number;
	endMonth: number;
	months: number[];
}

export function buildHalfYearSeason(year: number, half: 1 | 2): BeijingHalfYearSeason {
	const startMonthNum = half === 1 ? 1 : 7;
	const endMonthNum = half === 1 ? 6 : 12;
	const startMonth = year * 100 + startMonthNum;
	const endMonth = year * 100 + endMonthNum;
	const months: number[] = [];
	for (let m = startMonthNum; m <= endMonthNum; m++) {
		months.push(year * 100 + m);
	}
	return {
		year,
		half,
		label: `${year}H${half}`,
		startMonth,
		endMonth,
		months,
	};
}

export function calculateBeijingHalfYear(date: Date): BeijingHalfYearSeason {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
	});
	const parts = formatter.formatToParts(date);
	const year = parseInt(parts.find((p) => p.type === "year")?.value ?? "1970", 10);
	const month = parseInt(parts.find((p) => p.type === "month")?.value ?? "01", 10);
	const half: 1 | 2 = month <= 6 ? 1 : 2;
	return buildHalfYearSeason(year, half);
}

export function parseHalfYearSeason(seasonStr: string): BeijingHalfYearSeason {
	const trimmed = (seasonStr ?? "").trim();
	const match = trimmed.match(/^(\d{4})H([12])$/);
	if (!match) {
		throw new Error("Invalid season: format must be YYYYH1 or YYYYH2 (e.g. 2026H1)");
	}
	const year = parseInt(match[1], 10);
	const half = parseInt(match[2], 10) as 1 | 2;
	return buildHalfYearSeason(year, half);
}
