import { PlayerDetailPostgresRepository } from "./PlayerDetailPostgresRepository";
import { dataSource } from "../../../../../evolution-types/src/data-source";
import { parseHalfYearSeason } from "src/utils/calculateBeijingSeason";

jest.mock("../../../../../evolution-types/src/data-source", () => ({
	dataSource: {
		query: jest.fn(),
	},
}));

describe("PlayerDetailPostgresRepository", () => {
	let repository: PlayerDetailPostgresRepository;

	beforeEach(() => {
		repository = new PlayerDetailPostgresRepository();
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe("Summary queries (Task 2.1)", () => {
		it("queries overall summary, applies CTE ranking with stable sort and filters by userId without loading all players into Node", async () => {
			(dataSource.query as jest.Mock).mockResolvedValue([
				{
					userId: "user-1",
					username: "武藤游戏",
					points: 150,
					wins: 10,
					losses: 2,
					rank: 3,
				},
			]);

			const summary = await repository.getPlayerOverallSummary("user-1", "1103");

			expect(dataSource.query).toHaveBeenCalledTimes(1);
			const [sql, params] = (dataSource.query as jest.Mock).mock.calls[0];

			expect(params).toEqual(["1103", "user-1"]);
			expect(sql).toContain("ps.format_id = $1");
			expect(sql).toContain(
				'ROW_NUMBER() OVER (ORDER BY "points" DESC, "wins" DESC, "username" ASC) AS "rank"',
			);
			expect(sql).toContain('WHERE "userId" = $2');

			expect(summary).toEqual({
				rank: 3,
				points: 150,
				matches: 12,
				wins: 10,
				losses: 2,
				winRate: 0.8333,
			});
		});

		it("returns unranked zero summary when player has no overall stats in the format", async () => {
			(dataSource.query as jest.Mock).mockResolvedValue([]);

			const summary = await repository.getPlayerOverallSummary("user-not-found", "1103");

			expect(summary).toEqual({
				rank: null,
				points: 0,
				matches: 0,
				wins: 0,
				losses: 0,
				winRate: 0,
			});
		});

		it("queries half-year season summary with correct month boundaries and returns rank", async () => {
			(dataSource.query as jest.Mock).mockResolvedValue([
				{
					userId: "user-1",
					username: "武藤游戏",
					points: 80,
					wins: 5,
					losses: 1,
					rank: 2,
				},
			]);

			const halfYear = parseHalfYearSeason("2026H1");
			const summary = await repository.getPlayerSeasonSummary("user-1", "1109", halfYear);

			expect(dataSource.query).toHaveBeenCalledTimes(1);
			const [sql, params] = (dataSource.query as jest.Mock).mock.calls[0];

			expect(params).toEqual(["1109", 202601, 202606, "user-1"]);
			expect(sql).toContain("ps.format_id = $1 AND ps.season BETWEEN $2 AND $3");
			expect(sql).toContain('WHERE "userId" = $4');

			expect(summary).toEqual({
				rank: 2,
				points: 80,
				matches: 6,
				wins: 5,
				losses: 1,
				winRate: 0.8333,
			});
		});
	});

	describe("Deck stats queries (Task 2.3)", () => {
		it("aggregates deck stats by joining match_decks and duels (G1 duel_index=1 only) and filters anulled and soft-deleted matches", async () => {
			(dataSource.query as jest.Mock).mockResolvedValue([
				{
					deckTypeCode: "HERO",
					deckTypeName: "元素英雄",
					matches: 50,
					wins: 35,
					losses: 15,
					firstCount: 20,
					secondCount: 18,
				},
				{
					deckTypeCode: "unknown",
					deckTypeName: "未知",
					matches: 5,
					wins: 2,
					losses: 3,
					firstCount: 0,
					secondCount: 0,
				},
			]);

			const stats = await repository.getPlayerDeckStats("user-1", "1103");

			expect(dataSource.query).toHaveBeenCalledTimes(1);
			const [sql, params] = (dataSource.query as jest.Mock).mock.calls[0];

			expect(params).toEqual(["user-1", "1103"]);
			expect(sql).toContain("m.user_id = $1");
			expect(sql).toContain("m.format_id = $2");
			expect(sql).toContain("m.anulled = false");
			expect(sql).toContain("m.deleted_at IS NULL");
			expect(sql).toContain("d.duel_index = 1 AND d.deleted_at IS NULL");

			expect(stats).toHaveLength(2);
			expect(stats[0]).toEqual({
				deckTypeCode: "HERO",
				deckTypeName: "元素英雄",
				matches: 50,
				wins: 35,
				losses: 15,
				winRate: 0.7,
				firstCount: 20,
				secondCount: 18,
				firstRate: 0.5263,
			});
			expect(stats[1]).toEqual({
				deckTypeCode: "unknown",
				deckTypeName: "未知",
				matches: 5,
				wins: 2,
				losses: 3,
				winRate: 0.4,
				firstCount: 0,
				secondCount: 0,
				firstRate: null,
			});
		});

		it("supports season filtering for deck stats", async () => {
			(dataSource.query as jest.Mock).mockResolvedValue([]);
			const halfYear = parseHalfYearSeason("2026H2");

			await repository.getPlayerDeckStats("user-1", "1109", halfYear);

			const [sql, params] = (dataSource.query as jest.Mock).mock.calls[0];
			expect(params).toEqual(["user-1", "1109", 202607, 202612]);
			expect(sql).toContain("m.season BETWEEN $3 AND $4");
		});
	});

	describe("Rating trend and history pagination (Task 2.2, 2.4, 2.5)", () => {
		it("queries rating trend matches with LIMIT 20 ordered by date DESC, id DESC", async () => {
			(dataSource.query as jest.Mock).mockResolvedValue([
				{ matchId: "m20", date: new Date("2026-05-20"), pointsChange: 3 },
			]);

			const matches = await repository.getRatingTrendMatches("user-1", "1103");

			expect(dataSource.query).toHaveBeenCalledTimes(1);
			const [sql, params] = (dataSource.query as jest.Mock).mock.calls[0];

			expect(params).toEqual(["user-1", "1103"]);
			expect(sql).toContain("ORDER BY m.date DESC, m.id DESC");
			expect(sql).toContain("LIMIT 20");
			expect(matches).toHaveLength(1);
		});

		it("queries total match count excluding anulled and soft-deleted matches", async () => {
			(dataSource.query as jest.Mock).mockResolvedValue([{ count: 42 }]);

			const count = await repository.getMatchHistoryCount("user-1", "1103");

			const [sql, params] = (dataSource.query as jest.Mock).mock.calls[0];
			expect(params).toEqual(["user-1", "1103"]);
			expect(sql).toContain("COUNT(*)::int AS count");
			expect(sql).toContain("m.anulled = false");
			expect(sql).toContain("m.deleted_at IS NULL");
			expect(count).toBe(42);
		});

		it("queries paged matches with calculated settled points and opponent details", async () => {
			(dataSource.query as jest.Mock).mockResolvedValue([
				{
					matchId: "m1",
					gameId: "game-uuid-1",
					date: new Date("2026-05-01"),
					winner: true,
					playerScore: 2,
					opponentScore: 1,
					playerPointsChange: 3,
					season: 202605,
					playerSettledPoints: 120,
					opponentUserId: "user-2",
					opponentUsername: "海马濑人",
					opponentPlayerScore: 1,
					opponentPointsChange: -3,
					opponentSettledPoints: 95,
					opponentCanJump: true,
				},
			]);

			const page = await repository.getMatchHistoryPage("user-1", "1103", 0, 20);

			expect(dataSource.query).toHaveBeenCalledTimes(1);
			const [sql, params] = (dataSource.query as jest.Mock).mock.calls[0];

			expect(params).toEqual(["user-1", "1103", 20, 0]);
			expect(sql).toContain("LIMIT $3 OFFSET $4");
			expect(page).toHaveLength(1);
			expect(page[0].matchId).toBe("m1");
			expect(page[0].opponentUsername).toBe("海马濑人");
			expect(page[0].playerSettledPoints).toBe(120);
			expect(page[0].opponentSettledPoints).toBe(95);
		});

		it("batch queries match decks without loading card arrays or account sensitive fields", async () => {
			(dataSource.query as jest.Mock).mockResolvedValue([
				{
					matchId: "m1",
					deckTypeCode: "HERO",
					deckTypeName: "元素英雄",
					hasSnapshot: true,
					isPartial: false,
				},
			]);

			const decks = await repository.getMatchDecksBatch(["m1"], "1103");

			const [sql, params] = (dataSource.query as jest.Mock).mock.calls[0];
			expect(params).toEqual([["m1"], "1103"]);
			expect(sql).not.toContain("main_cards");
			expect(sql).not.toContain("password");
			expect(decks).toHaveLength(1);
		});

		it("batch queries duels without loading replay bytea data", async () => {
			(dataSource.query as jest.Mock).mockResolvedValue([
				{
					matchId: "m1",
					duelIndex: 1,
					replayId: "replay-uuid-1",
					isFirst: true,
				},
			]);

			const duels = await repository.getMatchDuelsBatch(["m1"]);

			const [sql, params] = (dataSource.query as jest.Mock).mock.calls[0];
			expect(params).toEqual([["m1"]]);
			expect(sql).not.toContain("replay_data");
			expect(duels).toHaveLength(1);
		});
	});
});
