export class HalfYearWindow {
	public readonly period: string;
	public readonly windowStart: string;
	public readonly windowEndExclusive: string;
	public readonly dataEndExclusive: string;

	private constructor(
		period: string,
		windowStart: string,
		windowEndExclusive: string,
		dataEndExclusive: string,
	) {
		this.period = period;
		this.windowStart = windowStart;
		this.windowEndExclusive = windowEndExclusive;
		this.dataEndExclusive = dataEndExclusive;
	}

	public static fromPeriodString(
		periodStr: string,
		referenceDateInput?: string | Date,
	): HalfYearWindow {
		const match = /^(\d{4})H([12])$/.exec(periodStr);
		if (!match) {
			throw new Error(`Invalid period string: ${periodStr}`);
		}
		const year = Number(match[1]);
		const half = match[2];
		const windowStart = half === "1" ? `${year}-01-01` : `${year}-07-01`;
		const windowEndExclusive = half === "1" ? `${year}-07-01` : `${year + 1}-01-01`;

		const todayStr = HalfYearWindow.toBeijingDateString(referenceDateInput);

		if (todayStr < windowStart) {
			throw new Error(`Cannot rebuild future period ${periodStr}: today is ${todayStr}`);
		}

		let dataEndExclusive = windowEndExclusive;
		if (todayStr < windowEndExclusive) {
			dataEndExclusive = todayStr;
		}

		return new HalfYearWindow(periodStr, windowStart, windowEndExclusive, dataEndExclusive);
	}

	public static current(referenceDateInput?: string | Date): HalfYearWindow {
		const dateStr = HalfYearWindow.toBeijingDateString(referenceDateInput);
		const [yearStr, monthStr] = dateStr.split("-");
		const year = Number(yearStr);
		const month = Number(monthStr);

		if (month >= 1 && month <= 6) {
			return new HalfYearWindow(`${year}H1`, `${year}-01-01`, `${year}-07-01`, dateStr);
		}
		return new HalfYearWindow(`${year}H2`, `${year}-07-01`, `${year + 1}-01-01`, dateStr);
	}

	public static previousOf(periodStr: string): HalfYearWindow {
		const match = /^(\d{4})H([12])$/.exec(periodStr);
		if (!match) {
			throw new Error(`Invalid period string: ${periodStr}`);
		}
		const year = Number(match[1]);
		const half = match[2];
		if (half === "2") {
			return new HalfYearWindow(`${year}H1`, `${year}-01-01`, `${year}-07-01`, `${year}-07-01`);
		}
		return new HalfYearWindow(
			`${year - 1}H2`,
			`${year - 1}-07-01`,
			`${year}-01-01`,
			`${year}-01-01`,
		);
	}

	public static periodFromWindowStart(windowStart: string): string {
		const match = /^(\d{4})-(01|07)-01$/.exec(windowStart);
		if (!match) {
			throw new Error(`Invalid windowStart: ${windowStart}`);
		}
		const year = match[1];
		const half = match[2] === "01" ? "H1" : "H2";
		return `${year}${half}`;
	}

	public static toBeijingDateString(input?: string | Date): string {
		if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
			return input;
		}
		const date = input instanceof Date ? input : new Date();
		const formatter = new Intl.DateTimeFormat("en-CA", {
			timeZone: "Asia/Shanghai",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		});
		return formatter.format(date);
	}
}
