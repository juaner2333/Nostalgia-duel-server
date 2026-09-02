import { Request, Response } from "express";
import { DownloadReplay } from "@shared/stats/replays/application/DownloadReplay";
import { ReplayPostgresRepository } from "@shared/stats/replays/infrastructure/postgres/ReplayPostgresRepository";
import { config } from "src/config";

export class DownloadReplayController {
	constructor(
		private readonly downloadReplay: DownloadReplay = new DownloadReplay(
			new ReplayPostgresRepository(),
		),
	) {}

	async run(req: Request, res: Response): Promise<void> {
		if (!config.ranking.enabled) {
			res.status(503).json({
				error: "Replay download is currently unavailable (ranking disabled)",
			});
			return;
		}

		const formatParam = req.params.format;
		const format = Array.isArray(formatParam) ? formatParam[0] : (formatParam ?? "");
		const replayIdParam = req.params.replayId;
		const replayId = Array.isArray(replayIdParam) ? replayIdParam[0] : (replayIdParam ?? "");

		try {
			const result = await this.downloadReplay.run({
				format,
				replayId,
			});

			const safeFilename = result.filename.replace(/"/g, "");
			const encodedFilename = encodeURIComponent(result.filename);
			res.setHeader("Content-Type", "application/octet-stream");
			res.setHeader(
				"Content-Disposition",
				`attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
			);
			res.status(200).send(result.replayData);
		} catch (error: any) {
			const isNotFound = error.message && error.message.toLowerCase().includes("not found");
			res.status(isNotFound ? 404 : 400).json({
				error: error.message || "Failed to download replay",
			});
		}
	}
}
