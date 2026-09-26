export type DeckCompleteness = "complete" | "partial";

export interface DeckSnapshotData {
	mainCards: number[];
	extraCards: number[];
	sideCards?: number[] | null;
}

export function formatDeckToYdk(snapshot: DeckSnapshotData): string {
	let content = "#main\r\n";
	for (const cardId of snapshot.mainCards) {
		content += `${cardId}\r\n`;
	}

	content += "#extra\r\n";
	for (const cardId of snapshot.extraCards) {
		content += `${cardId}\r\n`;
	}

	content += "!side\r\n";
	if (snapshot.sideCards && Array.isArray(snapshot.sideCards)) {
		for (const cardId of snapshot.sideCards) {
			content += `${cardId}\r\n`;
		}
	}

	return content;
}

export function formatBeijingDateForFilename(date: Date): string {
	const formatter = new Intl.DateTimeFormat("zh-CN", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	const parts = formatter.formatToParts(date);
	let year = "",
		month = "",
		day = "",
		hour = "",
		minute = "",
		second = "";
	for (const p of parts) {
		if (p.type === "year") year = p.value;
		else if (p.type === "month") month = p.value;
		else if (p.type === "day") day = p.value;
		else if (p.type === "hour") hour = p.value;
		else if (p.type === "minute") minute = p.value;
		else if (p.type === "second") second = p.value;
	}
	return `${year}-${month}-${day} ${hour}-${minute}-${second}`;
}

export function sanitizeFilenamePart(name: string): string {
	const withoutIllegal = name.replace(/[/\\?%*:|"<>]/g, "_");
	let cleaned = "";
	for (let i = 0; i < withoutIllegal.length; i++) {
		const code = withoutIllegal.charCodeAt(i);
		if ((code >= 0 && code <= 31) || code === 127) {
			continue;
		}
		cleaned += withoutIllegal[i];
	}
	return cleaned.trim() || "unknown";
}

export interface GenerateYdkFilenameOptions {
	date: Date;
	playerName: string;
	opponentName: string;
	completeness: DeckCompleteness;
}

export function generateYdkFilename(options: GenerateYdkFilenameOptions): string {
	const datePrefix = formatBeijingDateForFilename(options.date);
	const p1 = sanitizeFilenamePart(options.playerName);
	const p2 = sanitizeFilenamePart(options.opponentName);
	return `${datePrefix} ${p1} VS ${p2} (${options.completeness}).ydk`;
}
