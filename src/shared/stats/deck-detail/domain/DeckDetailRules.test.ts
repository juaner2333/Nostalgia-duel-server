import {
	aggregateTotalMatchup,
	buildDeckDetailCatalog,
	buildDeckDetailTimeWindow,
	calculateMatchupRates,
	calculateUsageRate,
	DeckDetailEightCounts,
	DeckDetailRawMatchupRow,
	DeckDetailRawTopPlayerRow,
	DeckDetailRawUsageCount,
	getNamedDeckTypes,
	MIN_TOP_PLAYER_MATCHES,
	resolveDeckSelection,
	sortAndRankTopPlayers,
	sortMatchupList,
	UNKNOWN_DECK_TYPE_CODE,
	UNKNOWN_DECK_TYPE_NAME_ZH,
	validateDeckDetailQuery,
	validateEightCountsInvariant,
} from "./DeckDetailRules";
import { DeckDetailQuery } from "./DeckDetailDto";

/**
 * 测试专用局部 make* 工厂与固定样本
 */
function makeEightCounts(overrides: Partial<DeckDetailEightCounts> = {}): DeckDetailEightCounts {
	const firstMatches = overrides.firstMatches ?? 10;
	const firstWins = overrides.firstWins ?? 6;
	const secondMatches = overrides.secondMatches ?? 8;
	const secondWins = overrides.secondWins ?? 4;
	const unknownSeatMatches = overrides.unknownSeatMatches ?? 2;
	const unknownSeatWins = overrides.unknownSeatWins ?? 1;

	const matches = overrides.matches ?? firstMatches + secondMatches + unknownSeatMatches;
	const matchWins = overrides.matchWins ?? firstWins + secondWins + unknownSeatWins;

	return {
		matches,
		matchWins,
		firstMatches,
		firstWins,
		secondMatches,
		secondWins,
		unknownSeatMatches,
		unknownSeatWins,
	};
}

function makeRawMatchupRow(
	opponentCode: string,
	overrides: Partial<DeckDetailEightCounts> = {},
): DeckDetailRawMatchupRow {
	return {
		opponentCode,
		...makeEightCounts(overrides),
	};
}

function makeRawTopPlayer(
	username: string,
	matches: number,
	wins: number,
): DeckDetailRawTopPlayerRow {
	return {
		username,
		matches,
		wins,
		losses: matches - wins,
		winRate: matches > 0 ? wins / matches : 0,
	};
}

describe("DeckDetailRules (Domain validation, catalog, and statistical rules)", () => {
	const fixedNow = new Date("2026-09-30T12:00:00.000Z"); // 北京时间 2026-09-30 20:00:00 (2026H2)

	describe("1.2 Input and Catalog validation", () => {
		it("validates dual formats: 1109 has named catalog, 1103 has no named catalog", () => {
			const catalog1109 = buildDeckDetailCatalog("1109");
			expect(catalog1109.length).toBe(30);
			expect(catalog1109[0]).toEqual({ code: "D01", nameZh: "代行天使" });
			expect(catalog1109.some((item) => item.code === "OTHERS")).toBe(false);

			const catalog1103 = buildDeckDetailCatalog("1103");
			expect(catalog1103).toEqual([]);
		});

		it("rejects unsupported format", () => {
			expect(() => validateDeckDetailQuery({ format: "9999" }, fixedNow)).toThrow(
				"不支持的赛制环境: 9999",
			);
		});

		it("defaults period to Beijing current half-year when omitted", () => {
			const res = validateDeckDetailQuery({ format: "1109" }, fixedNow);
			expect(res.period).toBe("2026H2");
		});

		it("accepts valid historical half-year period", () => {
			const res = validateDeckDetailQuery({ format: "1109", period: "2026H1" }, fixedNow);
			expect(res.period).toBe("2026H1");
		});

		it("rejects invalid period format like monthly or non-H1/H2", () => {
			expect(() =>
				validateDeckDetailQuery({ format: "1109", period: "2026-09" }, fixedNow),
			).toThrow("无效的半年周期格式");
			expect(() => validateDeckDetailQuery({ format: "1109", period: "2026H3" }, fixedNow)).toThrow(
				"无效的半年周期格式",
			);
		});

		it("rejects future half-year period", () => {
			expect(() => validateDeckDetailQuery({ format: "1109", period: "2027H1" }, fixedNow)).toThrow(
				"未来半年暂无统计数据: 2027H1",
			);
			expect(() => validateDeckDetailQuery({ format: "1109", period: "2030H2" }, fixedNow)).toThrow(
				"未来半年暂无统计数据: 2030H2",
			);
		});

		it("rejects submitting both deckTypeCode and q", () => {
			expect(() =>
				validateDeckDetailQuery({ format: "1109", deckTypeCode: "D01", q: "代行" }, fixedNow),
			).toThrow("不能同时指定卡组类型代码与搜索关键词");
		});

		it("rejects excluded deck type codes OTHERS and unknown", () => {
			expect(() =>
				validateDeckDetailQuery({ format: "1109", deckTypeCode: "OTHERS" }, fixedNow),
			).toThrow("不能查询其他卡组类型");
			expect(() =>
				validateDeckDetailQuery({ format: "1109", deckTypeCode: "unknown" }, fixedNow),
			).toThrow("不能查询未知卡组类型");
		});

		it("rejects q exceeding 64 characters", () => {
			const longQ = "a".repeat(65);
			expect(() => validateDeckDetailQuery({ format: "1109", q: longQ }, fixedNow)).toThrow(
				"搜索关键词不能超过 64 个字符",
			);
		});

		it("allows selecting deck types beyond top 16 (e.g. rank 17 D17 守墓)", () => {
			const selection = resolveDeckSelection("1109", "D17");
			expect(selection.kind).toBe("selected");
			if (selection.kind === "selected") {
				expect(selection.selected).toEqual({ code: "D17", nameZh: "守墓" });
			}
		});

		it("returns not_found for non-existent deck type code", () => {
			const selection = resolveDeckSelection("1109", "D99");
			expect(selection.kind).toBe("not_found");
		});

		it("returns not_found for any deck type code in 1103 (no named catalog)", () => {
			const selection = resolveDeckSelection("1103", "D01");
			expect(selection.kind).toBe("not_found");
		});

		it("supports literal substring search, treating %, _ literally", () => {
			// In 1109, "代行" matches "代行天使"
			const singleMatch = resolveDeckSelection("1109", undefined, "代行");
			expect(singleMatch.kind).toBe("selected");
			if (singleMatch.kind === "selected") {
				expect(singleMatch.selected.code).toBe("D01");
			}

			// Literal symbols % and _ do not act as wildcards
			const symbolMatch = resolveDeckSelection("1109", undefined, "%");
			expect(symbolMatch.kind).toBe("none");
			if (symbolMatch.kind === "none") {
				expect(symbolMatch.notFound).toBe(true);
				expect(symbolMatch.candidates).toEqual([]);
			}
		});

		it("handles multiple search hits by returning candidates", () => {
			// "英雄" matches "水泡英雄" (D25) and maybe others or search "均" matches "混沌均" (D10) and "不死均" (D30)
			const multiMatch = resolveDeckSelection("1109", undefined, "均");
			expect(multiMatch.kind).toBe("candidates");
			if (multiMatch.kind === "candidates") {
				expect(multiMatch.candidates.length).toBe(2);
				expect(multiMatch.candidates.map((c) => c.code)).toEqual(["D10", "D30"]);
			}
		});

		it("handles zero search hits with notFound = true", () => {
			const zeroMatch = resolveDeckSelection("1109", undefined, "青眼白龙");
			expect(zeroMatch.kind).toBe("none");
			if (zeroMatch.kind === "none") {
				expect(zeroMatch.notFound).toBe(true);
				expect(zeroMatch.candidates).toEqual([]);
			}
		});

		it("returns full catalog when neither deckTypeCode nor q is provided", () => {
			const noSelection = resolveDeckSelection("1109", undefined, undefined);
			expect(noSelection.kind).toBe("none");
			if (noSelection.kind === "none") {
				expect(noSelection.notFound).toBe(false);
				expect(noSelection.candidates.length).toBe(30);
			}
		});
	});

	describe("1.3 Counting and Ratio Rules", () => {
		it("enforces eight-counts conservation: matches = first + second + unknownSeat", () => {
			const counts = makeEightCounts({
				firstMatches: 50,
				firstWins: 30,
				secondMatches: 20,
				secondWins: 8,
				unknownSeatMatches: 10,
				unknownSeatWins: 4,
			});
			expect(() => validateEightCountsInvariant(counts)).not.toThrow();

			// Violation: matches does not equal sum
			expect(() =>
				validateEightCountsInvariant({
					...counts,
					matches: 81, // Should be 80
				}),
			).toThrow("计数守恒校验失败");

			// Violation: wins exceeds matches
			expect(() =>
				validateEightCountsInvariant({
					...counts,
					firstWins: 55, // Greater than firstMatches (50)
				}),
			).toThrow("胜场不能大于场数");
		});

		it("distinguishes unknown opponent from unknown seat and handles them separately", () => {
			// An unknown opponent can have known first/second seat
			const unknownOpponentRow = makeRawMatchupRow(UNKNOWN_DECK_TYPE_CODE, {
				firstMatches: 5,
				firstWins: 3,
				secondMatches: 5,
				secondWins: 2,
				unknownSeatMatches: 0,
				unknownSeatWins: 0,
			});
			// A named opponent can have unknown seat
			const namedOpponentRow = makeRawMatchupRow("D02", {
				firstMatches: 10,
				firstWins: 5,
				secondMatches: 10,
				secondWins: 5,
				unknownSeatMatches: 4,
				unknownSeatWins: 2,
			});

			expect(unknownOpponentRow.opponentCode).toBe(UNKNOWN_DECK_TYPE_CODE);
			expect(namedOpponentRow.unknownSeatMatches).toBe(4);
		});

		it("calculates rates correctly and returns null when denominator is 0", () => {
			const normalRates = calculateMatchupRates({
				matches: 80,
				matchWins: 42,
				firstMatches: 50,
				firstWins: 30,
				secondMatches: 20,
				secondWins: 8,
				unknownSeatMatches: 10,
				unknownSeatWins: 4,
			});
			expect(normalRates.matchWinRate).toBe(0.525);
			expect(normalRates.firstWinRate).toBe(0.6);
			expect(normalRates.secondWinRate).toBe(0.4);

			const zeroRates = calculateMatchupRates({
				matches: 0,
				matchWins: 0,
				firstMatches: 0,
				firstWins: 0,
				secondMatches: 0,
				secondWins: 0,
				unknownSeatMatches: 0,
				unknownSeatWins: 0,
			});
			expect(zeroRates.matchWinRate).toBeNull();
			expect(zeroRates.firstWinRate).toBeNull();
			expect(zeroRates.secondWinRate).toBeNull();

			// Real 0% win rate
			const zeroWinRates = calculateMatchupRates({
				matches: 3,
				matchWins: 0,
				firstMatches: 2,
				firstWins: 0,
				secondMatches: 1,
				secondWins: 0,
				unknownSeatMatches: 0,
				unknownSeatWins: 0,
			});
			expect(zeroWinRates.matchWinRate).toBe(0);
			expect(zeroWinRates.firstWinRate).toBe(0);
			expect(zeroWinRates.secondWinRate).toBe(0);
		});

		it("calculates usage rate: denominator is sum of named deck usages, null when denominator is 0", () => {
			expect(calculateUsageRate(20, 50)).toBe(0.4);
			expect(calculateUsageRate(0, 50)).toBe(0);
			expect(calculateUsageRate(0, 0)).toBeNull();
		});

		it("aggregates total matchup correctly and ensures matches equals usage.count", () => {
			const namedA = {
				opponentCode: "D01",
				opponentNameZh: "代行天使",
				...makeEightCounts({
					firstMatches: 10,
					firstWins: 6,
					secondMatches: 10,
					secondWins: 4,
					unknownSeatMatches: 0,
					unknownSeatWins: 0,
				}),
				...calculateMatchupRates(
					makeEightCounts({
						firstMatches: 10,
						firstWins: 6,
						secondMatches: 10,
						secondWins: 4,
						unknownSeatMatches: 0,
						unknownSeatWins: 0,
					}),
				),
			};
			const namedB = {
				opponentCode: "D02",
				opponentNameZh: "HB",
				...makeEightCounts({
					firstMatches: 5,
					firstWins: 2,
					secondMatches: 5,
					secondWins: 3,
					unknownSeatMatches: 2,
					unknownSeatWins: 1,
				}),
				...calculateMatchupRates(
					makeEightCounts({
						firstMatches: 5,
						firstWins: 2,
						secondMatches: 5,
						secondWins: 3,
						unknownSeatMatches: 2,
						unknownSeatWins: 1,
					}),
				),
			};
			const unknownOpponent = {
				opponentCode: UNKNOWN_DECK_TYPE_CODE,
				opponentNameZh: UNKNOWN_DECK_TYPE_NAME_ZH,
				...makeEightCounts({
					firstMatches: 2,
					firstWins: 1,
					secondMatches: 1,
					secondWins: 0,
					unknownSeatMatches: 1,
					unknownSeatWins: 0,
				}),
				...calculateMatchupRates(
					makeEightCounts({
						firstMatches: 2,
						firstWins: 1,
						secondMatches: 1,
						secondWins: 0,
						unknownSeatMatches: 1,
						unknownSeatWins: 0,
					}),
				),
			};

			const total = aggregateTotalMatchup([namedA, namedB, unknownOpponent]);
			// 20 + 12 + 4 = 36
			expect(total.matches).toBe(36);
			// (6+4) + (2+3+1) + (1+0+0) = 10 + 6 + 1 = 17
			expect(total.matchWins).toBe(17);
			expect(total.firstMatches).toBe(17);
			expect(total.firstWins).toBe(9);
			expect(total.secondMatches).toBe(16);
			expect(total.secondWins).toBe(7);
			expect(total.unknownSeatMatches).toBe(3);
			expect(total.unknownSeatWins).toBe(1);
			expect(total.opponentCode).toBe("TOTAL");
			expect(total.opponentNameZh).toBe("合计（不含其他，含未知对手）");
		});

		it("sorts matchups by matches DESC, deckTypeCode ASC, and puts unknown at the very end only when it has matches", () => {
			const catalog1109 = getNamedDeckTypes("1109");
			const rawRows: DeckDetailRawMatchupRow[] = [
				makeRawMatchupRow("D02", {
					matches: 50,
					matchWins: 25,
					firstMatches: 25,
					firstWins: 12,
					secondMatches: 25,
					secondWins: 13,
					unknownSeatMatches: 0,
					unknownSeatWins: 0,
				}),
				makeRawMatchupRow("D01", {
					matches: 50,
					matchWins: 30,
					firstMatches: 25,
					firstWins: 15,
					secondMatches: 25,
					secondWins: 15,
					unknownSeatMatches: 0,
					unknownSeatWins: 0,
				}),
				makeRawMatchupRow("D05", {
					matches: 10,
					matchWins: 6,
					firstMatches: 5,
					firstWins: 3,
					secondMatches: 5,
					secondWins: 3,
					unknownSeatMatches: 0,
					unknownSeatWins: 0,
				}),
				makeRawMatchupRow(UNKNOWN_DECK_TYPE_CODE, {
					matches: 5,
					matchWins: 2,
					firstMatches: 2,
					firstWins: 1,
					secondMatches: 2,
					secondWins: 1,
					unknownSeatMatches: 1,
					unknownSeatWins: 0,
				}),
			];

			const list = sortMatchupList(rawRows, catalog1109);
			// 30 named types + 1 unknown row = 31 items
			expect(list.length).toBe(31);

			// First two have 50 matches: D01 comes before D02 because D01 < D02
			expect(list[0].opponentCode).toBe("D01");
			expect(list[1].opponentCode).toBe("D02");
			// D05 has 10 matches
			expect(list[2].opponentCode).toBe("D05");
			// The rest have 0 matches and are sorted by deckTypeCode ASC
			expect(list[3].opponentCode).toBe("D03");
			expect(list[3].matches).toBe(0);
			expect(list[3].matchWinRate).toBeNull();

			// Unknown row is at the very end
			expect(list[30].opponentCode).toBe(UNKNOWN_DECK_TYPE_CODE);
			expect(list[30].opponentNameZh).toBe(UNKNOWN_DECK_TYPE_NAME_ZH);
			expect(list[30].matches).toBe(5);

			// If unknown row has 0 matches, it should NOT appear
			const rawRowsNoUnknown: DeckDetailRawMatchupRow[] = [
				makeRawMatchupRow("D01", {
					matches: 10,
					matchWins: 5,
					firstMatches: 5,
					firstWins: 2,
					secondMatches: 5,
					secondWins: 3,
					unknownSeatMatches: 0,
					unknownSeatWins: 0,
				}),
			];
			const listNoUnknown = sortMatchupList(rawRowsNoUnknown, catalog1109);
			expect(listNoUnknown.length).toBe(30);
			expect(listNoUnknown.some((item) => item.opponentCode === UNKNOWN_DECK_TYPE_CODE)).toBe(
				false,
			);
		});

		it("filters and sorts Top10 players: threshold >= 25, unrounded winRate DESC, matches DESC, username ASC, max 10", () => {
			const rawPlayers: DeckDetailRawTopPlayerRow[] = [
				makeRawTopPlayer("playerA", 24, 20), // 24 matches < 25 -> excluded
				makeRawTopPlayer("playerB", 30, 24), // 24/30 = 80.00%
				makeRawTopPlayer("playerC", 25, 20), // 20/25 = 80.00% (tied winRate, matches 25 < 30)
				makeRawTopPlayer("playerD", 25, 20), // 20/25 = 80.00% (tied winRate and matches, username 'playerD' > 'playerC')
				makeRawTopPlayer("playerE", 40, 36), // 36/40 = 90.00%
				makeRawTopPlayer("playerF", 25, 10), // 10/25 = 40.00%
			];

			const top = sortAndRankTopPlayers(rawPlayers);
			expect(top.length).toBe(5); // playerA excluded

			expect(top[0].username).toBe("playerE"); // 90%
			expect(top[0].rank).toBe(1);

			expect(top[1].username).toBe("playerB"); // 80%, 30 matches
			expect(top[1].rank).toBe(2);

			expect(top[2].username).toBe("playerC"); // 80%, 25 matches, 'playerC' < 'playerD'
			expect(top[2].rank).toBe(3);

			expect(top[3].username).toBe("playerD"); // 80%, 25 matches
			expect(top[3].rank).toBe(4);

			expect(top[4].username).toBe("playerF"); // 40%
			expect(top[4].rank).toBe(5);
		});

		it("limits Top10 players to 10 entries", () => {
			const rawPlayers: DeckDetailRawTopPlayerRow[] = [];
			for (let i = 1; i <= 15; i++) {
				rawPlayers.push(makeRawTopPlayer(`player${i.toString().padStart(2, "0")}`, 30, 15 + i));
			}
			const top = sortAndRankTopPlayers(rawPlayers);
			expect(top.length).toBe(10);
			expect(top[0].rank).toBe(1);
			expect(top[9].rank).toBe(10);
		});
	});

	describe("Time Window Construction", () => {
		it("builds time window for current period using query execution time as dataEndExclusive", () => {
			const queryTime = new Date("2026-09-30T16:00:00+08:00");
			const window = buildDeckDetailTimeWindow("2026H2", queryTime, queryTime);
			expect(window.period).toBe("2026H2");
			expect(window.windowStart).toBe("2026-07-01 00:00:00");
			expect(window.windowEndExclusive).toBe("2027-01-01 00:00:00");
			expect(window.isOngoing).toBe(true);
			expect(window.dataEndExclusive).toBe("2026-09-30 16:00:00");
		});

		it("builds time window for historical period using windowEndExclusive as dataEndExclusive", () => {
			const queryTime = new Date("2026-09-30T16:00:00+08:00");
			const window = buildDeckDetailTimeWindow("2026H1", queryTime, queryTime);
			expect(window.period).toBe("2026H1");
			expect(window.windowStart).toBe("2026-01-01 00:00:00");
			expect(window.windowEndExclusive).toBe("2026-07-01 00:00:00");
			expect(window.isOngoing).toBe(false);
			expect(window.dataEndExclusive).toBe("2026-07-01 00:00:00");
		});
	});
});
