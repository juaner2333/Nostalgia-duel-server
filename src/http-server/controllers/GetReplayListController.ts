import { Request, Response } from "express";
import { GetReplayList } from "@shared/stats/replays/application/GetReplayList";
import { ReplayPostgresRepository } from "@shared/stats/replays/infrastructure/postgres/ReplayPostgresRepository";
import { config } from "src/config";

export class GetReplayListController {
	constructor(
		private readonly getReplayList: GetReplayList = new GetReplayList(
			new ReplayPostgresRepository(),
		),
	) {}

	async run(req: Request, res: Response): Promise<void> {
		if (!config.ranking.enabled) {
			res.status(503).json({
				error: "Replay list is currently unavailable (ranking disabled)",
			});
			return;
		}

		const formatParam = req.params.format;
		const format = Array.isArray(formatParam) ? formatParam[0] : (formatParam ?? "");
		const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
		const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined;
		const search = typeof req.query.search === "string" ? req.query.search : undefined;

		try {
			const result = await this.getReplayList.run({
				format,
				page,
				pageSize,
				search,
			});

			res.status(200).json(result);
		} catch (error: any) {
			res.status(400).json({
				error: error.message || "Failed to retrieve replay list",
			});
		}
	}
}
