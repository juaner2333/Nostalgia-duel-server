import { Request, Response } from "express";
import { config } from "src/config";
import { dataSource } from "../../evolution-types/src/data-source";
import { GetUsageStatisticsUseCase } from "@shared/stats/usage/application/GetUsageStatisticsUseCase";
import { UsageStatisticsPostgresRepository } from "@shared/stats/usage/infrastructure/postgres/UsageStatisticsPostgresRepository";
import { CdbCardMetadataProvider } from "@shared/stats/usage/infrastructure/cdb/CdbCardMetadataProvider";

export class GetUsagePeriodsController {
	constructor(
		private readonly useCase: GetUsageStatisticsUseCase = new GetUsageStatisticsUseCase(
			new UsageStatisticsPostgresRepository(dataSource),
			new CdbCardMetadataProvider(),
		),
	) {}

	async run(req: Request, res: Response): Promise<void> {
		if (!config.ranking.enabled) {
			res.status(503).json({
				error: "Usage statistics are currently unavailable (ranking disabled)",
			});
			return;
		}

		const formatParam = req.params.format;
		const format = Array.isArray(formatParam) ? formatParam[0] : (formatParam ?? "");
		if (format !== "1103" && format !== "1109") {
			res.status(404).json({ error: `Unsupported format: ${format}` });
			return;
		}

		try {
			const result = await this.useCase.getPeriods(format);
			res.status(200).json(result);
		} catch (error: any) {
			res.status(400).json({
				error: error?.message || "Failed to retrieve usage periods",
			});
		}
	}
}
