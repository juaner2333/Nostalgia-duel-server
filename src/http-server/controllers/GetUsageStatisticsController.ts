import { Request, Response } from "express";
import { config } from "src/config";
import { dataSource } from "../../evolution-types/src/data-source";
import { GetUsageStatisticsUseCase } from "@shared/stats/usage/application/GetUsageStatisticsUseCase";
import { UsageStatisticsPostgresRepository } from "@shared/stats/usage/infrastructure/postgres/UsageStatisticsPostgresRepository";
import { CdbCardMetadataProvider } from "@shared/stats/usage/infrastructure/cdb/CdbCardMetadataProvider";

export class GetUsageStatisticsController {
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

		const metric = req.query.metric as string | undefined;
		if (!metric || !["deck", "monster", "spell", "trap", "extra", "side"].includes(metric)) {
			res.status(400).json({
				error:
					"Missing or invalid 'metric' parameter. Must be one of: deck, monster, spell, trap, extra, side",
			});
			return;
		}

		const period = typeof req.query.period === "string" ? req.query.period : undefined;
		if (period && !/^(\d{4})H([12])$/.test(period)) {
			res.status(400).json({
				error: "Invalid 'period' parameter. Must match YYYYH1 or YYYYH2",
			});
			return;
		}

		let page: number | undefined;
		if (req.query.page !== undefined) {
			const parsed = Number(req.query.page);
			if (isNaN(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
				res.status(400).json({
					error: "Invalid 'page' parameter: must be a positive integer",
				});
				return;
			}
			page = parsed;
		}

		let pageSize: number | undefined;
		if (req.query.pageSize !== undefined) {
			const parsed = Number(req.query.pageSize);
			if (isNaN(parsed) || parsed < 1 || parsed > 100 || !Number.isInteger(parsed)) {
				res.status(400).json({
					error: "Invalid 'pageSize' parameter: must be an integer between 1 and 100",
				});
				return;
			}
			pageSize = parsed;
		}

		try {
			const result = await this.useCase.getUsage({
				format,
				metric,
				period,
				page,
				pageSize,
			});
			res.status(200).json(result);
		} catch (error: any) {
			const msg = error?.message || "Failed to retrieve usage statistics";
			if (msg.includes("not ready") || msg.includes("not found")) {
				res.status(404).json({ error: msg });
			} else {
				res.status(400).json({ error: msg });
			}
		}
	}
}
