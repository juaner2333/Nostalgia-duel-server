import { LeaderboardPostgresRepository, escapeLike } from "./LeaderboardPostgresRepository";
import { dataSource } from "../../../../../evolution-types/src/data-source";

jest.mock("../../../../../evolution-types/src/data-source", () => ({
	dataSource: {
		query: jest.fn(),
	},
}));

describe("LeaderboardPostgresRepository", () => {
	let repository: LeaderboardPostgresRepository;

	beforeEach(() => {
		repository = new LeaderboardPostgresRepository();
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it("escapes LIKE wildcards correctly", () => {
		expect(escapeLike("100%_hero")).toBe("100\\%\\_hero");
	});

	it("queries half-year season leaderboard, maps label to 6-month range and aggregates cross-month stats", async () => {
		(dataSource.query as jest.Mock).mockResolvedValue([
			{
				userId: "u1",
				username: "Player1",
				points: 10,
				wins: 5,
				losses: 1,
				rank: 1,
				totalCount: 2,
			},
			{
				userId: "u2",
				username: "Player2",
				points: 5,
				wins: 3,
				losses: 2,
				rank: 2,
				totalCount: 2,
			},
		]);

		const result = await repository.getSeasonLeaderboard("1109", "2026H1");

		expect(dataSource.query).toHaveBeenCalledTimes(1);
		const [sql, params] = (dataSource.query as jest.Mock).mock.calls[0];

		// Isolates 1109, constrains to 202601-202606, aggregates across months with stable ranking
		expect(params).toEqual(["1109", 202601, 202606]);
		expect(sql).toContain("ps.format_id = $1 AND ps.season BETWEEN $2 AND $3");
		expect(sql).toContain("GROUP BY ps.user_id, u.username");
		expect(sql).toContain('ORDER BY "points" DESC, "wins" DESC, "username" ASC');

		expect(result).toEqual({
			total: 2,
			entries: [
				{
					rank: 1,
					userId: "u1",
					username: "Player1",
					points: 10,
					wins: 5,
					losses: 1,
					winRate: 0.8333,
				},
				{
					rank: 2,
					userId: "u2",
					username: "Player2",
					points: 5,
					wins: 3,
					losses: 2,
					winRate: 0.6,
				},
			],
		});
	});

	it("supports half-year season object range with search and pagination", async () => {
		(dataSource.query as jest.Mock).mockResolvedValue([
			{
				userId: "u5",
				username: "AliceHero",
				points: 30,
				wins: 15,
				losses: 3,
				rank: 5,
				totalCount: 1,
			},
		]);

		const result = await repository.getSeasonLeaderboard("1103", "2026H2", {
			search: "Alice",
			page: 2,
			pageSize: 20,
		});

		const [sql, params] = (dataSource.query as jest.Mock).mock.calls[0];
		expect(params).toEqual(["1103", 202607, 202612, "%Alice%", 20, 20]);
		expect(sql).toContain("ps.format_id = $1 AND ps.season BETWEEN $2 AND $3");
		expect(sql).toContain('WHERE "username" ILIKE $4');
		expect(sql).toContain("LIMIT $5 OFFSET $6");

		expect(result.total).toBe(1);
		expect(result.entries[0].rank).toBe(5);
		expect(result.entries[0].username).toBe("AliceHero");
	});

	it("queries overall leaderboard across all months without season restriction", async () => {
		(dataSource.query as jest.Mock).mockResolvedValue([
			{
				userId: "u1",
				username: "Player1",
				points: "25",
				wins: "12",
				losses: "3",
				rank: 1,
				totalCount: 1,
			},
		]);

		const result = await repository.getOverallLeaderboard("1103");

		expect(dataSource.query).toHaveBeenCalledTimes(1);
		const [sql, params] = (dataSource.query as jest.Mock).mock.calls[0];
		expect(params).toEqual(["1103"]);
		expect(sql).toContain("WHERE ps.format_id = $1");
		expect(sql).not.toContain("ps.season");
		expect(result).toEqual({
			total: 1,
			entries: [
				{
					rank: 1,
					userId: "u1",
					username: "Player1",
					points: 25,
					wins: 12,
					losses: 3,
					winRate: 0.8,
				},
			],
		});
	});

	it("gets player half-year season stats when player exists in season list", async () => {
		(dataSource.query as jest.Mock).mockResolvedValue([
			{
				userId: "u1",
				username: "Player1",
				points: 10,
				wins: 5,
				losses: 1,
				rank: 1,
				totalCount: 2,
			},
			{
				userId: "u2",
				username: "Player2",
				points: 5,
				wins: 3,
				losses: 2,
				rank: 2,
				totalCount: 2,
			},
		]);

		const stats = await repository.getPlayerSeasonStats("u2", "1109", "2026H1");

		expect(stats).toEqual({
			format: "1109",
			season: "2026H1",
			points: 5,
			wins: 3,
			losses: 2,
			winRate: 0.6,
			rank: 2,
		});
	});

	it("returns unranked default stats when player is not in half-year season list", async () => {
		(dataSource.query as jest.Mock).mockResolvedValue([]);

		const stats = await repository.getPlayerSeasonStats("u-none", "1109", "2026H2");

		expect(stats).toEqual({
			format: "1109",
			season: "2026H2",
			points: 0,
			wins: 0,
			losses: 0,
			winRate: 0,
			rank: null,
		});
	});
});
