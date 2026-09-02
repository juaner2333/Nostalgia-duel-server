import { ReplayRepository } from "../domain/ReplayRepository";
import { SUPPORTED_REPLAY_FORMATS, SupportedReplayFormat } from "../domain/Replay";

export interface DownloadReplayRequest {
	format: string;
	replayId: string;
}

export interface DownloadReplayResponse {
	replayId: string;
	formatId: string;
	filename: string;
	replayData: Buffer;
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

export class DownloadReplay {
	constructor(private readonly repository: ReplayRepository) {}

	async run(request: DownloadReplayRequest): Promise<DownloadReplayResponse> {
		if (!SUPPORTED_REPLAY_FORMATS.includes(request.format as SupportedReplayFormat)) {
			throw new Error(`Invalid format: ${request.format}`);
		}

		const replay = await this.repository.getReplayById(request.format, request.replayId);
		if (!replay) {
			throw new Error("Replay not found");
		}

		const datePrefix = formatBeijingDateForFilename(replay.endedAt);
		const p1 = sanitizeFilenamePart(replay.player1Name);
		const p2 = sanitizeFilenamePart(replay.player2Name);
		const filename = `${datePrefix} ${p1} VS ${p2}.yrp`;

		return {
			replayId: replay.replayId,
			formatId: replay.formatId,
			filename,
			replayData: replay.replayData,
		};
	}
}
