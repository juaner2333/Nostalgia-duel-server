import {
	renderUsageDashboardPage,
	UsageDashboardPageController,
} from "./UsageDashboardPageController";
import { Request, Response } from "express";

describe("UsageDashboardPageBehavior", () => {
	const html1103 = renderUsageDashboardPage("1103");
	const html1109 = renderUsageDashboardPage("1109");

	it("renders page with correct format isolation and brand title", () => {
		expect(html1103).toContain('var FORMAT = "1103";');
		expect(html1109).toContain('var FORMAT = "1109";');
		expect(html1103).toContain("1103 使用率");
		expect(html1109).toContain("1109 使用率");
		expect(html1103).toContain("/leaderboards/1103");
		expect(html1109).toContain("/leaderboards/1109");
	});

	it("contains six metric tabs: deck, monster, spell, trap, extra, side", () => {
		expect(html1109).toContain('data-metric="deck"');
		expect(html1109).toContain('data-metric="monster"');
		expect(html1109).toContain('data-metric="spell"');
		expect(html1109).toContain('data-metric="trap"');
		expect(html1109).toContain('data-metric="extra"');
		expect(html1109).toContain('data-metric="side"');
	});

	it("contains period selector and statistics elements", () => {
		expect(html1109).toContain('id="select-period"');
		expect(html1109).toContain('id="stat-total-decks"');
		expect(html1109).toContain('id="stat-side-known-decks"');
		expect(html1109).toContain('id="stat-window-range"');
		expect(html1109).toContain('id="stat-data-end"');
		expect(html1109).toContain('id="stat-published-at"');
		expect(html1109).toContain('id="stat-notice"');
	});

	it("contains refresh button and pagination controls", () => {
		expect(html1109).toContain('id="btn-refresh-usage"');
		expect(html1109).toContain('id="btn-prev-page"');
		expect(html1109).toContain('id="btn-next-page"');
		expect(html1109).toContain('id="page-info"');
	});

	it("includes script logic for URL synchronization and resetting page to 1 on period/tab switch", () => {
		expect(html1109).toContain("history.pushState");
		expect(html1109).toContain("state.page = 1");
		expect(html1109).toContain('"/api/ladder/" + FORMAT + "/usage');
		expect(html1109).toContain('"/api/ladder/" + FORMAT + "/usage/periods"');
		expect(html1109).toContain("https://ygocdb.com/card/");
	});

	it("handles controller HTTP status codes correctly", () => {
		const controller = new UsageDashboardPageController();
		const res404: Partial<Response> = {
			status: jest.fn().mockReturnThis(),
			send: jest.fn().mockReturnThis(),
		};
		controller.run({ params: { format: "invalid" } } as unknown as Request, res404 as Response);
		expect(res404.status).toHaveBeenCalledWith(404);

		const res200: Partial<Response> = {
			status: jest.fn().mockReturnThis(),
			setHeader: jest.fn().mockReturnThis(),
			send: jest.fn().mockReturnThis(),
		};
		controller.run({ params: { format: "1109" } } as unknown as Request, res200 as Response);
		expect(res200.status).toHaveBeenCalledWith(200);
	});
});
