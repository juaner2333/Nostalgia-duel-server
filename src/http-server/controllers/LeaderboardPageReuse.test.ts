import { renderLeaderboardPage } from "./LeaderboardPageController";

describe("Leaderboard page self-contained styling and format reuse", () => {
	it("does not depend on external fonts, CDNs, or third-party frontend frameworks", () => {
		const html = renderLeaderboardPage("1103");
		expect(html).not.toContain("https://");
		expect(html).not.toContain("http://");
		expect(html).not.toContain("<script src=");
		expect(html).not.toContain('<link rel="stylesheet"');
	});

	it("contains responsive table container styles for narrow screens (<= 480px)", () => {
		const html = renderLeaderboardPage("1103");
		expect(html).toContain("overflow-x: auto;");
		expect(html).toContain("@media (max-width: 480px)");
	});

	it("demonstrates parameterization and format isolation for 1103, 1109 and future formats", () => {
		const html1103 = renderLeaderboardPage("1103");
		const html1109 = renderLeaderboardPage("1109");
		const htmlCustom = renderLeaderboardPage("1201");

		expect(html1103).toContain('var FORMAT = "1103";');
		expect(html1109).toContain('var FORMAT = "1109";');
		expect(htmlCustom).toContain('var FORMAT = "1201";');

		// 1103 only uses 1103 API routes
		expect(html1103).toContain('"/api/replays/" + FORMAT');
		expect(html1103).toContain('"/api/leaderboards/" + FORMAT');
		expect(html1103).not.toContain('"1109"');

		// 1109 only uses 1109 API routes
		expect(html1109).toContain('"/api/replays/" + FORMAT');
		expect(html1109).toContain('"/api/leaderboards/" + FORMAT');
		expect(html1109).not.toContain('"1103"');
	});
});
