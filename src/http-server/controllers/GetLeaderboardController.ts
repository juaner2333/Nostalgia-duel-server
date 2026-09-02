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

		let page: number | undefined;
		if (req.query.page !== undefined) {
			const parsed = Number(req.query.page);
			if (isNaN(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
				res.status(400).json({ error: "Invalid 'page' parameter: must be a positive integer" });
				return;
			}
			page = parsed;
		}

		let pageSize: number | undefined;
		if (req.query.pageSize !== undefined) {
			const parsed = Number(req.query.pageSize);
			if (isNaN(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
				res.status(400).json({ error: "Invalid 'pageSize' parameter: must be a positive integer" });
				return;
			}
			pageSize = parsed;
		}

		const search = typeof req.query.search === "string" ? req.query.search : undefined;

		try {
			const result = await this.getLeaderboard.run({
				format,
				scope,
				season,
				search,
				page,
				pageSize,
			});

			res.status(200).json(result);
		} catch (error: any) {
			res.status(400).json({
				error: error.message || "Failed to retrieve leaderboard",
			});
		}
	}
}
