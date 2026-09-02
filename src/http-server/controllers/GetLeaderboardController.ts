import { Request, Response } from "express";
import { GetLeaderboard } from "@shared/stats/leaderboard/application/GetLeaderboard";
import { LeaderboardPostgresRepository } from "@shared/stats/leaderboard/infrastructure/postgres/LeaderboardPostgresRepository";
import { config } from "src/config";

export class GetLeaderboardController {
	constructor(
		private readonly getLeaderboard: GetLeaderboard = new GetLeaderboard(
			new LeaderboardPostgresRepository(),
		),
	) {}

	async run(req: Request, res: Response): Promise<void> {
		if (!config.ranking.enabled) {
			res.status(503).json({
				error: "Leaderboard is currently unavailable (ranking disabled)",
			});
			return;
		}

		const formatParam = req.params.format;
		const format = Array.isArray(formatParam) ? formatParam[0] : (formatParam ?? "");
		const scope = req.query.scope as string | undefined;
		const season = typeof req.query.season === "string" ? req.query.season : undefined;

		if (!scope || (scope !== "season" && scope !== "overall")) {
			res.status(400).json({
				error: "Missing or invalid 'scope' query parameter (must be 'season' or 'overall')",
			});
			return;
		}

		if (scope === "overall" && season !== undefined) {
			res.status(400).json({
				error: "The 'season' parameter is not allowed when scope is 'overall'",
			});
			return;
		}

		try {
			const result = await this.getLeaderboard.run({
				format,
				scope,
				season,
			});

			res.status(200).json(result);
		} catch (error: any) {
			res.status(400).json({
				error: error.message || "Failed to retrieve leaderboard",
			});
		}
	}
}
