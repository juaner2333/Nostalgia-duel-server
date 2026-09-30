import { renderDeckDetailPage } from "./DeckDetailPageController";

describe("DeckDetailPage Behavior and Layout Specification (Tasks 4.1 - 4.4)", () => {
	const html1103 = renderDeckDetailPage("1103");
	const html1109 = renderDeckDetailPage("1109");

	describe("Page structure, branding and navigation (Task 4.1)", () => {
		it("renders brand, format badge and return links to ladder, usage, and deck-stats", () => {
			expect(html1109).toContain("Nostalgia Duel Server");
			expect(html1109).toContain("1109 卡组详情");
			expect(html1109).toContain("/leaderboards/1109");
			expect(html1109).toContain("/leaderboards/1109/usage");
			expect(html1109).toContain("/leaderboards/1109/deck-stats");

			expect(html1103).toContain("1103 卡组详情");
		});

		it("contains search input, search button, refresh button, and season selectors", () => {
			expect(html1109).toContain('id="deck-search-input"');
			expect(html1109).toContain('id="btn-search-deck"');
			expect(html1109).toContain('id="btn-refresh-deck"');
			expect(html1109).toContain('id="deck-season-year"');
			expect(html1109).toContain('id="deck-season-half"');
			expect(html1109).toContain('id="btn-query-season"');
		});

		it("contains candidates container, deck info card, matchup table, and top players table", () => {
			expect(html1109).toContain('id="deck-candidates-container"');
			expect(html1109).toContain('id="card-deck-header"');
			expect(html1109).toContain('id="table-matchups"');
			expect(html1109).toContain('id="table-top-players"');
			expect(html1109).toContain('id="page-status-message"');
		});
	});

	describe("Module content and statistical notes (Task 4.2 - 4.4)", () => {
		it("explains realtime query, Asia/Shanghai timezone, exclusion of OTHERS, and retention of unknown opponent", () => {
			expect(html1109).toContain("实时查询");
			expect(html1109).toContain("Asia/Shanghai");
			expect(html1109).toContain("排除其他");
			expect(html1109).toContain("未知对手保留");
			expect(html1109).toContain("具名卡组使用占比");
		});

		it("renders matchup table headers with 综合, G1先攻, G1后攻, and 未知座次说明", () => {
			expect(html1109).toContain("对手卡组");
			expect(html1109).toContain("Match 综合胜率");
			expect(html1109).toContain("G1 先攻胜率");
			expect(html1109).toContain("G1 后攻胜率");
			expect(html1109).toContain("G1 座次未知场数");
		});

		it("renders Top10 player threshold notice (至少 25 场有效 Match) and player detail link", () => {
			expect(html1109).toContain("专精玩家胜率 Top10");
			expect(html1109).toContain("至少 25 场有效 Match");
			expect(html1109).toContain("/leaderboards/1109/player");
		});

		it("links Top10 players to player-detail with scope=season and season=<period> (Task 5.4)", () => {
			expect(html1109).toContain("/leaderboards/1109/player?player=");
			expect(html1109).toContain("&scope=season&season=");
			expect(html1109).toContain("encodeURIComponent(data.period)");
		});

		it("handles 1103 environment without named categories by displaying clear empty state", () => {
			expect(html1103).toContain("当前环境暂无具名卡组分类");
		});

		it("contains client script for URL state sync, request race isolation, and data-insufficient display", () => {
			expect(html1109).toContain("deckTypeCode");
			expect(html1109).toContain("history.replaceState");
			expect(html1109).toContain("数据不足");
			expect(html1109).toContain("currentRequestId");
		});
	});
});
