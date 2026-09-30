import { Request, Response } from "express";
import { getNostalgiaFormat } from "@ygopro/room/domain/NostalgiaFormat";
import { config } from "src/config";
import LoggerFactory from "src/shared/logger/infrastructure/LoggerFactory";
import {
	DeckDetailNotFoundError,
	GetDeckDetail,
} from "src/shared/stats/deck-detail/application/GetDeckDetail";
import { DeckDetailPostgresRepository } from "src/shared/stats/deck-detail/infrastructure/postgres/DeckDetailPostgresRepository";

/**
 * 卡组详情 REST API 控制器
 * 接口路径：GET /api/ladder/:format/deck-detail
 * 业务意图与设计决策（Trade-offs）：
 * 1. 严格响应格式：成功返回 { success: true, data: ... }，失败返回 { success: false, error: ... }；
 * 2. 状态码规范：排位未启用 503、非法赛制或不存在的具名卡组 404、校验失败或格式错误 400；
 * 3. 严格禁止数组注入：对 period/deckTypeCode/q 若传入数组参数直接返回 400 报错，禁止静默截断；
 * 4. 禁用 HTTP 缓存：对局统计为实时一致查询，设置全套禁用缓存头。
 */
export class GetDeckDetailController {
	public constructor(
		private readonly getDeckDetail: GetDeckDetail = new GetDeckDetail(
			new DeckDetailPostgresRepository(),
			LoggerFactory.getLogger({ module: "GetDeckDetailController" }),
		),
	) {}

	public async run(req: Request, res: Response): Promise<void> {
		if (!config.ranking.enabled) {
			res.status(503).json({
				success: false,
				error: "Deck detail is currently unavailable (ranking disabled)",
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

		// 检查 query 参数是否包含数组，拒绝异常参数形式
		if (
			Array.isArray(req.query.period) ||
			Array.isArray(req.query.deckTypeCode) ||
			Array.isArray(req.query.q)
		) {
			res.status(400).json({
				success: false,
				error: "参数类型错误: 不支持数组参数",
			});
			return;
		}

		res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
		res.setHeader("Pragma", "no-cache");
		res.setHeader("Expires", "0");

		const period = typeof req.query.period === "string" ? req.query.period : undefined;
		const deckTypeCode =
			typeof req.query.deckTypeCode === "string" ? req.query.deckTypeCode : undefined;
		const q = typeof req.query.q === "string" ? req.query.q : undefined;

		try {
			const result = await this.getDeckDetail.execute({
				format,
				period,
				deckTypeCode,
				q,
			});

			res.status(200).json({
				success: true,
				data: result,
			});
		} catch (error: any) {
			if (error instanceof DeckDetailNotFoundError) {
				res.status(404).json({
					success: false,
					error: error.message || "未找到指定的卡组类型",
				});
				return;
			}

			res.status(400).json({
				success: false,
				error: error.message || "查询卡组详情失败",
			});
		}
	}
}
