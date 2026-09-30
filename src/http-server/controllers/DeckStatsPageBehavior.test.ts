import { Request, Response } from "express";
import { renderLeaderboardPage } from "./LeaderboardPageController";
import { renderUsageDashboardPage } from "./UsageDashboardPageController";
import { renderDeckStatsPage, DeckStatsPageController } from "./DeckStatsPageController";

describe("DeckStatsPageBehavior", () => {
	const html1109 = renderDeckStatsPage("1109");

	describe("Page title, format isolation and navigation tabs", () => {
		it("renders page with correct title and 1109 branding", () => {
			expect(html1109).toContain("<title>Nostalgia Duel Server · 1109 卡组胜率</title>");
			expect(html1109).toContain('var FORMAT = "1109";');
			expect(html1109).toContain("1109 专区");
		});

		it("contains 5 top navigation tabs on 1109 with deck-stats active", () => {
			expect(html1109).toContain("/leaderboards/1109?tab=rooms");
			expect(html1109).toContain("/leaderboards/1109?tab=replays");
			expect(html1109).toContain("/leaderboards/1109?tab=ladder");
			expect(html1109).toContain("/leaderboards/1109/usage");
			expect(html1109).toContain("/leaderboards/1109/deck-stats");
			expect(html1109).toMatch(
				/<a[^>]*href="\/leaderboards\/1109\/deck-stats"[^>]*class="[^"]*active[^"]*"[^>]*>卡组胜率<\/a>/,
			);
		});

		it("interlinks with LeaderboardPage and UsageDashboardPage on 1109, but isolates 1103", () => {
			const lb1109 = renderLeaderboardPage("1109");
			const lb1103 = renderLeaderboardPage("1103");
			const usage1109 = renderUsageDashboardPage("1109");
			const usage1103 = renderUsageDashboardPage("1103");

			expect(lb1109).toContain("/leaderboards/1109/deck-stats");
			expect(lb1109).toContain("卡组胜率");
			expect(lb1103).not.toContain("/leaderboards/1103/deck-stats");
			expect(lb1103).not.toContain("卡组胜率");

			expect(usage1109).toContain("/leaderboards/1109/deck-stats");
			expect(usage1109).toContain("卡组胜率");
			expect(usage1103).not.toContain("/leaderboards/1103/deck-stats");
			expect(usage1103).not.toContain("卡组胜率");
		});

		it("returns 404 for 1103 or invalid formats in controller", async () => {
			const controller = new DeckStatsPageController();
			const res1103: Partial<Response> = {
				status: jest.fn().mockReturnThis(),
				send: jest.fn().mockReturnThis(),
			};
			await controller.run(
				{ params: { format: "1103" } } as unknown as Request,
				res1103 as Response,
			);
			expect(res1103.status).toHaveBeenCalledWith(404);

			const resInvalid: Partial<Response> = {
				status: jest.fn().mockReturnThis(),
				send: jest.fn().mockReturnThis(),
			};
			await controller.run(
				{ params: { format: "edopro" } } as unknown as Request,
				resInvalid as Response,
			);
			expect(resInvalid.status).toHaveBeenCalledWith(404);

			const res1109: Partial<Response> = {
				status: jest.fn().mockReturnThis(),
				setHeader: jest.fn().mockReturnThis(),
				send: jest.fn().mockReturnThis(),
			};
			await controller.run(
				{ params: { format: "1109" } } as unknown as Request,
				res1109 as Response,
			);
			expect(res1109.status).toHaveBeenCalledWith(200);
		});
	});

	describe("Match Views, Period selection and Statistics Bar", () => {
		it("provides three match view buttons: overall, first, and second", () => {
			expect(html1109).toContain('data-view="overall"');
			expect(html1109).toContain('data-view="first"');
			expect(html1109).toContain('data-view="second"');
			expect(html1109).toContain("Match 综合胜率");
			expect(html1109).toContain("Match 先攻胜率");
			expect(html1109).toContain("Match 后攻胜率");
		});

		it("contains period selector and refresh controls", () => {
			expect(html1109).toContain('id="select-period"');
			expect(html1109).toContain('id="btn-refresh"');
		});

		it("contains statistics elements: window range, data end, admitted matches, published at and notice", () => {
			expect(html1109).toContain('id="stat-window-range"');
			expect(html1109).toContain('id="stat-data-end"');
			expect(html1109).toContain('id="stat-admitted-matches"');
			expect(html1109).toContain('id="stat-published-at"');
			expect(html1109).toContain('id="stat-notice"');
		});
	});

	describe("Matrix Table Structure, Responsive Scroll and Data Display", () => {
		it("supports responsive horizontal scrolling via table container", () => {
			expect(html1109).toContain("table-container");
			expect(html1109).toMatch(/\.table-container\s*\{[^}]*overflow-x:\s*auto/);
		});

		it("contains matrix table and tbody", () => {
			expect(html1109).toContain('id="matrix-table"');
			expect(html1109).toContain('id="matrix-tbody"');
			expect(html1109).toContain('id="matrix-thead"');
		});

		it("specifies Top 16 inner total header without implying all decks", () => {
			expect(html1109).toContain("前 16 内合计");
		});

		it("displays '数据不足' instead of '0%' when matches count is zero", () => {
			expect(html1109).toContain("数据不足");
		});

		it("uses the API's :: separator for matrix cell lookups", () => {
			expect(html1109).toContain('var key = deckA.code + "::" + deckB.code;');
		});
	});

	describe("Client-side URL Synchronization, Anti-race, and XSS Protection", () => {
		it("recovers and syncs state to URL via history.pushState / searchParams", () => {
			expect(html1109).toContain("history.pushState");
			expect(html1109).toContain("URLSearchParams");
		});

		it("guards against race conditions using incrementing requestId", () => {
			expect(html1109).toContain("var reqId = ++state.requestId;");
			expect(html1109).toContain("if (reqId !== state.requestId) return;");
		});

		it("fetches deck stats and periods from correct 1109 API endpoints", () => {
			expect(html1109).toContain('"/api/ladder/" + FORMAT + "/deck-stats"');
			expect(html1109).toContain('"/api/ladder/" + FORMAT + "/deck-stats/periods"');
		});

		it("includes HTML escaping logic for deck names and strings to prevent XSS", () => {
			expect(html1109).toContain("escapeHtml");
		});

		it("5.2 links matrix row and column headers to deck-detail with period preserved and target='_blank' while total column has no link", () => {
			expect(html1109).toContain("/deck-detail?deckTypeCode=");
			expect(html1109).toContain('target="_blank"');
			expect(html1109).toContain("encodeURIComponent(state.period)");
			expect(html1109).toContain(
				'<th class="total-col-header" title="仅汇总本方对入选前 16 名类别的对局">前 16 内合计</th>',
			);
		});
	});
});
