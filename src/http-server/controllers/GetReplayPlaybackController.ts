import { Request, Response } from "express";

import { ReplayPostgresRepository } from "@shared/stats/replays/infrastructure/postgres/ReplayPostgresRepository";
import {
	ReplayPlaybackError,
	type ReplayPlaybackResult,
	simulateReplayPlayback,
} from "@shared/stats/replay-playback/application/SimulateReplayPlayback";
import { config } from "src/config";

const PLAYBACK_CACHE_LIMIT = 10;

/**
 * Re-simulates a stored .yrp through the WASM core and returns the full game
 * message stream plus a card-name map, so the browser player can render the
 * duel without any engine of its own.
 */
export class GetReplayPlaybackController {
	private readonly playbackCache = new Map<string, Promise<ReplayPlaybackResult>>();

	constructor(private readonly replayRepository = new ReplayPostgresRepository()) {}

	async run(req: Request, res: Response): Promise<void> {
		res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

		if (!config.ranking.enabled) {
			res.status(503).json({
				success: false,
				error: "录像回放当前不可用（排位系统未启用）。",
			});
			return;
		}

		const formatParam = req.params.format;
		const format = Array.isArray(formatParam) ? formatParam[0] : (formatParam ?? "");
		const replayIdParam = req.params.replayId;
		const replayId = Array.isArray(replayIdParam) ? replayIdParam[0] : (replayIdParam ?? "");
		const engineParam = req.query.engine;
		const engine = typeof engineParam === "string" && /^[0-9A-Za-z_-]+$/.test(engineParam)
			? engineParam
			: undefined;

		try {
			const playback = await this.loadPlayback(format, replayId, engine);
			res.status(200).json({ success: true, data: playback });
		} catch (error) {
			if (error instanceof ReplayPlaybackError) {
				res.status(400).json({ success: false, error: error.clientMessage });
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			if (message.toLowerCase().includes("not found")) {
				res.status(404).json({ success: false, error: "录像不存在。" });
				return;
			}
			res.status(500).json({ success: false, error: "录像回放生成失败，请稍后重试。" });
		}
	}

	private loadPlayback(format: string, replayId: string, engine?: string): Promise<ReplayPlaybackResult> {
		const cacheKey = `${format}/${replayId}/${engine ?? "auto"}`;
		const cached = this.playbackCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		const pending = (async () => {
			const replay = await this.replayRepository.getReplayById(format, replayId);
			if (!replay) {
				throw new Error("Replay not found");
			}
			return simulateReplayPlayback(format, replay.replayData, { engine });
		})();

		pending.catch(() => this.playbackCache.delete(cacheKey));
		this.playbackCache.set(cacheKey, pending);
		if (this.playbackCache.size > PLAYBACK_CACHE_LIMIT) {
			const oldestKey = this.playbackCache.keys().next().value;
			if (oldestKey !== undefined && oldestKey !== cacheKey) {
				this.playbackCache.delete(oldestKey);
			}
		}
		return pending;
	}
}
