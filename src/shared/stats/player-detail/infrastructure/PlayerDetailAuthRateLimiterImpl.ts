import { PlayerDetailAuthRateLimiter } from "../domain/PlayerDetailAuthRateLimiter";

export interface RedisLike {
	get(key: string): Promise<string | null>;
	incr(key: string): Promise<number>;
	expire(key: string, seconds: number): Promise<unknown>;
	del(key: string): Promise<unknown>;
}

/**
 * 玩家详情密码验证失败次数限制实现
 * 业务意图：
 * 针对暴力猜测密码行为实施严格的频次预算限制：
 * 同一 IP 针对同一玩家账号在 60 秒内最多允许 5 次失败，第 6 次起直接拦截并返回 429。
 * 验证成功后立即清空失败计数，避免合法玩家被长期阻断。
 * 容灾设计（Trade-off）：
 * 优先使用 Redis 集中式计数共享状态；当 Redis 不可用或报错时，自动无缝降级为基于内存的本地 LRU/TTL 计数，
 * 绝不因缓存故障而放弃安全防线（Fail-closed for brute-force security）。
 */
export class PlayerDetailAuthRateLimiterImpl implements PlayerDetailAuthRateLimiter {
	private readonly maxFailures = 5;
	private readonly windowMs: number;
	private readonly memoryStore = new Map<string, { count: number; expiresAt: number }>();

	constructor(
		private readonly redis: RedisLike | null = null,
		windowMs = 60_000,
	) {
		this.windowMs = windowMs;
	}

	private buildKey(sourceIp: string, normalizedUsername: string): string {
		return `rate-limit:player-auth:${sourceIp.trim()}:${normalizedUsername.trim().toLowerCase()}`;
	}

	async isLimited(sourceIp: string, normalizedUsername: string): Promise<boolean> {
		const key = this.buildKey(sourceIp, normalizedUsername);

		// 优先尝试从 Redis 读取
		if (this.redis) {
			try {
				const val = await this.redis.get(key);
				if (val !== null && Number(val) >= this.maxFailures) {
					return true;
				}
			} catch {
				// Redis 故障时静默降级到内存计数
			}
		}

		// 检查内存计数
		const entry = this.memoryStore.get(key);
		if (entry) {
			if (Date.now() > entry.expiresAt) {
				this.memoryStore.delete(key);
				return false;
			}
			return entry.count >= this.maxFailures;
		}

		return false;
	}

	async recordFailure(sourceIp: string, normalizedUsername: string): Promise<void> {
		const key = this.buildKey(sourceIp, normalizedUsername);
		const windowSeconds = Math.ceil(this.windowMs / 1000);

		// 尝试写入 Redis
		if (this.redis) {
			try {
				const count = await this.redis.incr(key);
				if (count === 1) {
					await this.redis.expire(key, windowSeconds);
				}
			} catch {
				// Redis 故障时降级到本地内存
			}
		}

		// 同步记录内存计数作为本地兜底
		const now = Date.now();
		const entry = this.memoryStore.get(key);
		if (!entry || now > entry.expiresAt) {
			this.memoryStore.set(key, {
				count: 1,
				expiresAt: now + this.windowMs,
			});
		} else {
			entry.count += 1;
		}
	}

	async reset(sourceIp: string, normalizedUsername: string): Promise<void> {
		const key = this.buildKey(sourceIp, normalizedUsername);

		if (this.redis) {
			try {
				await this.redis.del(key);
			} catch {
				// Redis 故障忽略
			}
		}

		this.memoryStore.delete(key);
	}
}
