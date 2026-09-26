import { Request, Response } from "express";
import { DownloadMatchDeck } from "@shared/deck/application/DownloadMatchDeck";
import { MatchDeckPostgresRepository } from "@shared/deck/infrastructure/postgres/MatchDeckPostgresRepository";
import { config } from "src/config";

export class DownloadMatchDeckController {
	constructor(
		private readonly downloadMatchDeck: DownloadMatchDeck = new DownloadMatchDeck(
			new MatchDeckPostgresRepository(),
		),
	) {}

	async run(req: Request, res: Response): Promise<void> {
		if (!config.ranking.enabled) {
			res.status(503).json({
				error: "Ranked deck download is currently unavailable (ranking disabled)",
			});
			return;
		}

		const formatParam = req.params.format;
		const format = Array.isArray(formatParam) ? formatParam[0] : (formatParam ?? "");
		const matchIdParam = req.params.matchId;
		const matchId = Array.isArray(matchIdParam) ? matchIdParam[0] : (matchIdParam ?? "");

		try {
			const result = await this.downloadMatchDeck.run({
				format,
				matchId,
			});

			const encodedFilename = encodeURIComponent(result.filename);
			res.setHeader("Content-Type", "text/plain; charset=utf-8");
			res.setHeader("X-Deck-Completeness", result.completeness);
			res.setHeader(
				"Content-Disposition",
				`attachment; filename="${result.safeAsciiFilename}"; filename*=UTF-8''${encodedFilename}`,
			);
			res.status(200).send(result.ydkContent);
		} catch (error: any) {
			const isNotFound = error.message && error.message.toLowerCase().includes("not found");
			res.status(isNotFound ? 404 : 400).json({
				error: error.message || "Failed to download match deck",
			});
		}
	}
}
