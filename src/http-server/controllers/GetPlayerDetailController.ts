import { Request, Response } from "express";
import { getNostalgiaFormat } from "@ygopro/room/domain/NostalgiaFormat";
import { config } from "src/config";
import { Redis } from "src/shared/db/redis/infrastructure/Redis";
import LoggerFactory from "src/shared/logger/infrastructure/LoggerFactory";
import {
	GetPlayerDetail,
	PlayerDetailRateLimitExceededError,
} from "src/shared/stats/player-detail/application/GetPlayerDetail";
import { PlayerDetailAuthRateLimiterImpl } from "src/shared/stats/player-detail/infrastructure/PlayerDetailAuthRateLimiterImpl";
import { PlayerDetailPostgresRepository } from "src/shared/stats/player-detail/infrastructure/postgres/PlayerDetailPostgresRepository";
import { UserProfilePostgresRepository } from "src/shared/user-profile/infrastructure/postgres/UserProfilePostgresRepository";

export class GetPlayerDetailController {
	constructor(
		private readonly getPlayerDetail: GetPlayerDetail = new GetPlayerDetail(
			new PlayerDetailPostgresRepository(),
			new UserProfilePostgresRepository(),
			new PlayerDetailAuthRateLimiterImpl(Redis.getInstance()),
			LoggerFactory.getLogger({ module: "GetPlayerDetailController" }),
		),
	) {}

	async run(req: Request, res: Response): Promise<void> {
		if (!config.ranking.enabled) {
			res.status(503).json({
				success: false,
				error: "Player detail is currently unavailable (ranking disabled)",
			});
			return;
		}

		const formatParam = req.params.format;
		const format = Array.isArray(formatParam) ? formatParam[0] : (formatParam ?? "");

		if (!getNostalgiaFormat(format)) {
			res.status(404).json({
				success: false,
				error: `Unknown format: ${format}`,
			});
			return;
		}

		res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
		res.setHeader("Pragma", "no-cache");
		res.setHeader("Expires", "0");

		const body = req.body || {};
		const player = typeof body.player === "string" ? body.player : "";
		const scope = body.scope;
		const season = typeof body.season === "string" ? body.season : undefined;
		const password = typeof body.password === "string" ? body.password : undefined;
		const page = body.page !== undefined ? Number(body.page) : undefined;
		const sourceIp = req.ip || req.socket.remoteAddress || "unknown";

		try {
			const result = await this.getPlayerDetail.execute(
				{
					player,
					format,
					scope,
					season,
					password,
					page,
				},
				sourceIp,
			);

			res.status(200).json({
				success: true,
				data: result,
			});
		} catch (error: any) {
			if (error instanceof PlayerDetailRateLimitExceededError) {
				res.status(429).json({
					success: false,
					error: error.message || "密码验证尝试过于频繁，请稍后再试",
				});
				return;
			}

			res.status(400).json({
				success: false,
				error: error.message || "查询玩家战绩详情失败",
			});
		}
	}
}
