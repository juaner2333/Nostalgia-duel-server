import { Request, Response } from "express";
import { config } from "src/config";
import { dataSource } from "../../evolution-types/src/data-source";
import {
	GetDeckMatchupStatsUseCase,
	FormatNotSupportedError,
	StatsNotReadyError,
} from "@shared/stats/matchup/application/GetDeckMatchupStatsUseCase";
import { UsageStatisticsPostgresRepository } from "@shared/stats/usage/infrastructure/postgres/UsageStatisticsPostgresRepository";

export class GetDeckStatsController {
	constructor(
		private readonly useCase: GetDeckMatchupStatsUseCase = new GetDeckMatchupStatsUseCase(
			new UsageStatisticsPostgresRepository(dataSource),
		),
	) {}

	async run(req: Request, res: Response): Promise<void> {
		if (!config.ranking.enabled) {
			res.status(503).json({
				error: "Deck statistics are currently unavailable (ranking disabled)",
			});
			return;
		}

		const formatParam = req.params.format;
		const format = Array.isArray(formatParam) ? formatParam[0] : (formatParam ?? "");
		if (format !== "1109") {
			res.status(404).json({ error: `Unsupported format: ${format}. Only 1109 is supported.` });
			return;
		}

		const period = typeof req.query.period === "string" ? req.query.period : undefined;
		if (period && !/^(\d{4})H([12])$/.test(period)) {
			res.status(400).json({
				error: "Invalid 'period' parameter. Must match YYYYH1 or YYYYH2",
			});
			return;
		}

		try {
			const result = await this.useCase.execute({ format, period });
			res.status(200).json(result);
		} catch (error: any) {
			if (error instanceof FormatNotSupportedError) {
				res.status(404).json({ error: error.message });
			} else if (error instanceof StatsNotReadyError) {
				res.status(404).json({ error: error.message });
			} else {
				res.status(400).json({
					error: error?.message || "Failed to retrieve deck statistics",
				});
			}
		}
	}
}
