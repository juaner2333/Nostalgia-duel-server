import {
	aggregateDeckStats,
	calculateG1FirstRate,
	calculateRatingTrend,
	calculateSettledPointsForMatches,
	calculateWinRate,
	PLAYER_DETAIL_PAGE_SIZE,
	RawPlayerDeckMatchInput,
	validatePlayerDetailQuery,
} from "./PlayerDetailRules";

describe("PlayerDetailRules (Domain validation and statistical rules)", () => {
	describe("Input and scope validation", () => {
		it("accepts valid player name and trims whitespace", () => {
			const res = validatePlayerDetailQuery({
				player: "  游城十代  ",
				format: "1103",
			});
			expect(res.player).toBe("游城十代");
			expect(res.format).toBe("1103");
			expect(res.scope).toBe("season");
			expect(res.page).toBe(1);
			expect(res.pageSize).toBe(PLAYER_DETAIL_PAGE_SIZE);
		});

		it("rejects empty or whitespace-only player name", () => {
			expect(() =>
				validatePlayerDetailQuery({
					player: "   ",
					format: "1103",
				}),
			).toThrow("玩家昵称不能为空");
		});

		it("rejects unsupported format", () => {
			expect(() =>
				validatePlayerDetailQuery({
					player: "游戏",
					format: "9999",
				}),
			).toThrow("不支持的赛制环境: 9999");
		});

		it("accepts overall scope without season", () => {
			const res = validatePlayerDetailQuery({
				player: "游戏",
				format: "1103",
				scope: "overall",
			});
			expect(res.scope).toBe("overall");
			expect(res.season).toBeNull();
		});

		it("rejects overall scope with season provided", () => {
			expect(() =>
				validatePlayerDetailQuery({
					player: "游戏",
					format: "1103",
					scope: "overall",
					season: "2026H1",
				}),
			).toThrow("总战绩模式不能携带赛季参数");
		});

		it("accepts valid season for season scope", () => {
			const res = validatePlayerDetailQuery({
				player: "游戏",
				format: "1109",
				scope: "season",
				season: "2026H2",
			});
			expect(res.scope).toBe("season");
			expect(res.season).toBe("2026H2");
		});

		it("rejects invalid season formats including monthly formats like 2026-09 or 202609", () => {
			expect(() =>
				validatePlayerDetailQuery({
					player: "游戏",
					format: "1103",
					scope: "season",
					season: "2026-09",
				}),
			).toThrow("无效的半年赛季格式");

			expect(() =>
				validatePlayerDetailQuery({
					player: "游戏",
					format: "1103",
					scope: "season",
					season: "2026H3",
				}),
			).toThrow("无效的半年赛季格式");
		});

		it("defaults to Beijing current half-year season when scope is season and season is omitted", () => {
			// 2026-06-30 15:59:59 UTC is 2026-06-30 23:59:59 Beijing time -> 2026H1
			const dateH1 = new Date(Date.UTC(2026, 5, 30, 15, 59, 59));
			const resH1 = validatePlayerDetailQuery(
				{
					player: "游戏",
					format: "1103",
				},
				dateH1,
			);
			expect(resH1.season).toBe("2026H1");

			// 2026-06-30 16:00:00 UTC is 2026-07-01 00:00:00 Beijing time -> 2026H2
			const dateH2 = new Date(Date.UTC(2026, 5, 30, 16, 0, 0));
			const resH2 = validatePlayerDetailQuery(
				{
					player: "游戏",
					format: "1103",
				},
				dateH2,
			);
			expect(resH2.season).toBe("2026H2");
		});

		it("validates page to be positive integer and enforces fixed page size of 20", () => {
			const res = validatePlayerDetailQuery({
				player: "游戏",
				format: "1103",
				page: 3,
			});
			expect(res.page).toBe(3);
			expect(res.pageSize).toBe(20);

			expect(() =>
				validatePlayerDetailQuery({
					player: "游戏",
					format: "1103",
					page: 0,
				}),
			).toThrow("页码必须为正整数");

			expect(() =>
				validatePlayerDetailQuery({
					player: "游戏",
					format: "1103",
					page: 1.5,
				}),
			).toThrow("页码必须为正整数");

			expect(() =>
				validatePlayerDetailQuery({
					player: "游戏",
					format: "1103",
					page: -2,
				}),
			).toThrow("页码必须为正整数");
		});
	});

	describe("Win rate and G1 first-hand rate calculations", () => {
		it("calculates win rate correctly and returns 0 when matches is 0", () => {
			expect(calculateWinRate(5, 8)).toBe(0.625);
			expect(calculateWinRate(1, 3)).toBe(0.3333);
			expect(calculateWinRate(0, 0)).toBe(0);
		});

		it("calculates G1 first rate with known first and second count (12 / 8 gives 60%)", () => {
			expect(calculateG1FirstRate(12, 8)).toBe(0.6);
		});

		it("returns 0 when all known records are second-hand (0 / 5 gives 0%)", () => {
			expect(calculateG1FirstRate(0, 5)).toBe(0);
		});

		it("returns null when no known first/second hand records exist (0 / 0 gives null)", () => {
			expect(calculateG1FirstRate(0, 0)).toBeNull();
		});
	});

	describe("Deck stats aggregation rules", () => {
		it("counts each Match exactly once even with 3 duels (G1, G2, G3) and ignores G2/G3 first-hand", () => {
			const matchInputs: RawPlayerDeckMatchInput[] = [
				{
					matchId: "match-1",
					deckTypeCode: "HERO",
					deckTypeName: "英雄",
					winner: true,
					g1First: true, // G1先手
				},
				{
					matchId: "match-2",
					deckTypeCode: "HERO",
					deckTypeName: "英雄",
					winner: false,
					g1First: false, // G1后手
				},
				{
					matchId: "match-3",
					deckTypeCode: "HERO",
					deckTypeName: "英雄",
					winner: true,
					g1First: null, // G1未知
				},
			];

			const stats = aggregateDeckStats(matchInputs);
			expect(stats).toHaveLength(1);
			const hero = stats[0];
			expect(hero.deckTypeCode).toBe("HERO");
			expect(hero.matches).toBe(3);
			expect(hero.wins).toBe(2);
			expect(hero.losses).toBe(1);
			expect(hero.winRate).toBe(0.6667);
			expect(hero.firstCount).toBe(1);
			expect(hero.secondCount).toBe(1);
			expect(hero.firstRate).toBe(0.5); // 1 / (1 + 1) = 50%
		});

		it("keeps OTHERS and unknown as separate categories", () => {
			const matchInputs: RawPlayerDeckMatchInput[] = [
				{
					matchId: "m1",
					deckTypeCode: "OTHERS",
					deckTypeName: "其他",
					winner: true,
					g1First: true,
				},
				{
					matchId: "m2",
					deckTypeCode: "unknown",
					deckTypeName: "未知",
					winner: false,
					g1First: null,
				},
			];

			const stats = aggregateDeckStats(matchInputs);
			expect(stats).toHaveLength(2);
			expect(stats.find((s) => s.deckTypeCode === "OTHERS")).toEqual({
				deckTypeCode: "OTHERS",
				deckTypeName: "其他",
				matches: 1,
				wins: 1,
				losses: 0,
				winRate: 1,
				firstCount: 1,
				secondCount: 0,
				firstRate: 1,
			});
			expect(stats.find((s) => s.deckTypeCode === "unknown")).toEqual({
				deckTypeCode: "unknown",
				deckTypeName: "未知",
				matches: 1,
				wins: 0,
				losses: 1,
				winRate: 0,
				firstCount: 0,
				secondCount: 0,
				firstRate: null,
			});
		});

		it("sorts deck stats by matches DESC then deckTypeCode ASC", () => {
			const matchInputs: RawPlayerDeckMatchInput[] = [
				{ matchId: "m1", deckTypeCode: "Z_DECK", deckTypeName: "Z", winner: true, g1First: true },
				{ matchId: "m2", deckTypeCode: "A_DECK", deckTypeName: "A", winner: true, g1First: true },
				{ matchId: "m3", deckTypeCode: "A_DECK", deckTypeName: "A", winner: false, g1First: false },
			];

			const stats = aggregateDeckStats(matchInputs);
			expect(stats[0].deckTypeCode).toBe("A_DECK"); // 2 matches
			expect(stats[1].deckTypeCode).toBe("Z_DECK"); // 1 match
		});
	});

	describe("Rating trend and settled points deduction", () => {
		it("calculates 20-match rating trend ending at current overall points", () => {
			// Current total points: 103
			// Recent 3 matches chronologically (oldest to newest): +2, -1, +2
			// Newest-first: +2, -1, +2
			const recentMatchesDesc = [
				{ matchId: "m3", date: new Date("2026-03-03T10:00:00Z"), pointsChange: 2 },
				{ matchId: "m2", date: new Date("2026-03-02T10:00:00Z"), pointsChange: -1 },
				{ matchId: "m1", date: new Date("2026-03-01T10:00:00Z"), pointsChange: 2 },
			];

			const trend = calculateRatingTrend(103, recentMatchesDesc);
			// 3 matches produce 4 points:
			// before m1: 100
			// after m1: 102
			// after m2: 101
			// after m3: 103
			expect(trend).toHaveLength(4);
			expect(trend.map((p) => p.points)).toEqual([100, 102, 101, 103]);
			expect(trend[0].matchId).toBeNull();
			expect(trend[3].matchId).toBe("m3");
			expect(trend[3].points).toBe(103);
		});

		it("returns empty rating trend if player has 0 matches", () => {
			const trend = calculateRatingTrend(0, []);
			expect(trend).toEqual([]);
		});

		it("handles negative points, single match, and flat trends", () => {
			// Single match with pointsChange = -5, ending at -5 (baseline was 0)
			const trend = calculateRatingTrend(-5, [
				{ matchId: "m1", date: new Date("2026-01-01Z"), pointsChange: -5 },
			]);
			expect(trend).toHaveLength(2);
			expect(trend[0].points).toBe(0);
			expect(trend[1].points).toBe(-5);
		});

		it("calculates settled points for matches list by deducting newer matches pointsChange", () => {
			// Current overall points: 120
			// Matches in newest-first order on the page:
			// Suppose m1 is newest on page, and previously sum of points of matches newer than m1 was 5.
			const matches = [
				{ matchId: "m1", pointsChange: 3 },
				{ matchId: "m2", pointsChange: -2 },
				{ matchId: "m3", pointsChange: 4 },
			];
			const priorNewerPointsSum = 5; // e.g. 5 points accumulated from matches on page 1
			const settled = calculateSettledPointsForMatches(120, matches, priorNewerPointsSum);

			// m1 settled points: 120 - 5 = 115
			// m2 settled points: 115 - 3 = 112
			// m3 settled points: 112 - (-2) = 114
			expect(settled).toEqual([115, 112, 114]);
		});
	});
});
