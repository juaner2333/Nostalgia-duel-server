import { PlayerDetailAuthRateLimiterImpl } from "./PlayerDetailAuthRateLimiterImpl";

describe("PlayerDetailAuthRateLimiterImpl", () => {
	it("allows up to 5 failures within 60s and blocks on the 6th failure", async () => {
		const limiter = new PlayerDetailAuthRateLimiterImpl(null); // in-memory fallback
		const ip = "127.0.0.1";
		const username = "player1";

		for (let i = 0; i < 5; i++) {
			expect(await limiter.isLimited(ip, username)).toBe(false);
			await limiter.recordFailure(ip, username);
		}

		// 6th check should be blocked
		expect(await limiter.isLimited(ip, username)).toBe(true);
	});

	it("isolates failure counts between different target players and source IPs", async () => {
		const limiter = new PlayerDetailAuthRateLimiterImpl(null);
		const ip1 = "127.0.0.1";
		const ip2 = "192.168.1.1";
		const userA = "playera";
		const userB = "playerb";

		for (let i = 0; i < 5; i++) {
			await limiter.recordFailure(ip1, userA);
		}

		// ip1 on userA is limited
		expect(await limiter.isLimited(ip1, userA)).toBe(true);
		// ip1 on userB is NOT limited
		expect(await limiter.isLimited(ip1, userB)).toBe(false);
		// ip2 on userA is NOT limited
		expect(await limiter.isLimited(ip2, userA)).toBe(false);
	});

	it("clears failure count when reset is called upon successful verification", async () => {
		const limiter = new PlayerDetailAuthRateLimiterImpl(null);
		const ip = "127.0.0.1";
		const username = "player1";

		for (let i = 0; i < 5; i++) {
			await limiter.recordFailure(ip, username);
		}
		expect(await limiter.isLimited(ip, username)).toBe(true);

		// Successful login clears failures
		await limiter.reset(ip, username);
		expect(await limiter.isLimited(ip, username)).toBe(false);
	});

	it("expires entries after TTL window", async () => {
		const limiter = new PlayerDetailAuthRateLimiterImpl(null, 100); // 100ms TTL for testing
		const ip = "127.0.0.1";
		const username = "player1";

		for (let i = 0; i < 5; i++) {
			await limiter.recordFailure(ip, username);
		}
		expect(await limiter.isLimited(ip, username)).toBe(true);

		await new Promise((resolve) => setTimeout(resolve, 120));
		expect(await limiter.isLimited(ip, username)).toBe(false);
	});

	it("works with Redis and falls back cleanly on Redis errors", async () => {
		const mockRedis = {
			get: jest.fn().mockRejectedValue(new Error("Redis offline")),
			incr: jest.fn().mockRejectedValue(new Error("Redis offline")),
			expire: jest.fn().mockRejectedValue(new Error("Redis offline")),
			del: jest.fn().mockRejectedValue(new Error("Redis offline")),
		};

		const limiter = new PlayerDetailAuthRateLimiterImpl(mockRedis as any);
		const ip = "127.0.0.1";
		const username = "player1";

		// Even when Redis errors out, the in-memory fallback still enforces the limit
		for (let i = 0; i < 5; i++) {
			expect(await limiter.isLimited(ip, username)).toBe(false);
			await limiter.recordFailure(ip, username);
		}
		expect(await limiter.isLimited(ip, username)).toBe(true);
	});
});
