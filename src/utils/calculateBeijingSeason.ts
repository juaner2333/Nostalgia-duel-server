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
