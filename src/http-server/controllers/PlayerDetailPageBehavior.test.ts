import { renderPlayerDetailPage } from "./PlayerDetailPageController";

describe("PlayerDetailPage Behavior and Layout Specification (Tasks 4.2 - 4.6)", () => {
	const html1103 = renderPlayerDetailPage("1103");
	const html1109 = renderPlayerDetailPage("1109");

	describe("Page structure, branding and layout", () => {
		it("renders brand and format badge without return link", () => {
			expect(html1103).toContain("Nostalgia Duel Server");
			expect(html1103).toContain("1103");
			expect(html1109).toContain("1109");
			expect(html1103).not.toContain("返回天梯");
			expect(html1103).not.toContain("/leaderboards/1103?tab=ladder");
		});

		it("contains single query input supporting nickname and nickname$password with Chinese hints", () => {
			expect(html1103).toContain('id="player-search-input"');
			expect(html1103).toContain('id="btn-search-player"');
			expect(html1103).toContain('id="btn-refresh-player"');
			expect(html1103).toContain("昵称$密码");
		});

		it("contains scope selector with overall and half-year season options", () => {
			expect(html1103).toContain('id="btn-scope-season"');
			expect(html1103).toContain('id="btn-scope-overall"');
			expect(html1103).toContain('id="player-season-year"');
			expect(html1103).toContain('id="player-season-half"');
			expect(html1103).toContain('id="btn-query-season"');
		});

		it("contains mode indicator and auth status hints", () => {
			expect(html1103).toContain('id="mode-indicator"');
			expect(html1103).toContain("公开模式");
			expect(html1103).toContain("本人验证模式");
		});
	});

	describe("Module order and content (Task 4.3)", () => {
		it("orders modules: overall summary -> overall decks -> season summary -> season decks -> rating trend -> matches", () => {
			const overallSummaryIdx = html1103.indexOf('id="section-overall-summary"');
			const overallDecksIdx = html1103.indexOf('id="section-overall-decks"');
			const seasonSummaryIdx = html1103.indexOf('id="section-season-summary"');
			const seasonDecksIdx = html1103.indexOf('id="section-season-decks"');
			const ratingTrendIdx = html1103.indexOf('id="section-rating-trend"');
			const matchesIdx = html1103.indexOf('id="section-matches"');

			expect(overallSummaryIdx).toBeGreaterThan(0);
			expect(overallDecksIdx).toBeGreaterThan(overallSummaryIdx);
			expect(seasonSummaryIdx).toBeGreaterThan(overallDecksIdx);
			expect(seasonDecksIdx).toBeGreaterThan(seasonSummaryIdx);
			expect(ratingTrendIdx).toBeGreaterThan(seasonDecksIdx);
			expect(matchesIdx).toBeGreaterThan(ratingTrendIdx);
		});

		it("renders deck tables with 6 columns: type, matches, record, winRate, G1 first/second, firstRate", () => {
			expect(html1103).toContain("卡组类型");
			expect(html1103).toContain("场次");
			expect(html1103).toContain("胜负");
			expect(html1103).toContain("胜率");
			expect(html1103).toContain("先手 / 后手次数");
			expect(html1103).toContain("先手率");
			expect(html1103).toContain("G1");
			expect(html1103).toContain("未知");
		});

		it("provides G1 note and explains unknown records excluded from denominator", () => {
			expect(html1103).toContain("统计单位为整场 Match");
			expect(html1103).toContain("未知记录不计入先手率分母");
		});

		it("explains rating trend is backward-deduced from current overall points using all-time 20 matches", () => {
			expect(html1103).toContain("全时期最近最多二十场");
			expect(html1103).toContain("倒推");
		});
	});

	describe("Matches list, downloads and pagination (Task 4.4, 4.5)", () => {
		it("renders match history table with opponent jump link in new tab, settled points, YDK and YRP links", () => {
			expect(html1103).toContain('id="table-matches"');
			expect(html1103).toContain("比分");
			expect(html1103).toContain("G1先后手");
			expect(html1103).toContain("双方卡组");
			expect(html1103).toContain("积分变化及结算后总积分");
			expect(html1103).not.toContain("<th>双方积分变化及结算后总积分</th>");
			expect(html1103).toContain("双方卡组下载");
			expect(html1103).toContain("小局录像");
			expect(html1103).toContain('aOpp.target = "_blank"');
		});

		it("renders both player and opponent deck download entries in client script", () => {
			expect(html1103).toContain("opponentDeck");
			expect(html1103).toContain("本方");
			expect(html1103).toContain("对手");
		});

		it("renders partial deck badge for partial snapshots", () => {
			expect(html1103).toContain("部分卡组");
		});

		it("contains history pagination controls with prev and next buttons", () => {
			expect(html1103).toContain('id="btn-prev-history"');
			expect(html1103).toContain('id="btn-next-history"');
			expect(html1103).toContain('id="history-page-info"');
		});
	});

	describe("Client script security, input parsing and race condition prevention (Task 4.2, 4.5, 4.6)", () => {
		it("splits input by first $ character and resets input display to nickname only", () => {
			expect(html1103).toContain('var dollarIdx = rawInput.indexOf("$");');
			expect(html1103).toContain("inputEl.value = player;");
		});

		it("does not store password in URL or DOM storage", () => {
			expect(html1103).not.toContain("localStorage");
			expect(html1103).not.toContain("sessionStorage");
			expect(html1103).toContain("history.replaceState");
			expect(html1103).not.toMatch(/replaceState\([^)]*password/);
		});

		it("guards against race conditions using incrementing requestId", () => {
			expect(html1103).toContain("var reqId = ++state.requestId;");
			expect(html1103).toContain("if (reqId !== state.requestId) return;");
		});

		it("safely uses textContent to prevent XSS attacks", () => {
			expect(html1103).toContain("textContent = ");
		});

		it("5.3 links season decks, overall decks, and matches history to deck-detail with period", () => {
			expect(html1109).toContain("/deck-detail?deckTypeCode=");
			expect(html1109).toContain('d.deckTypeCode !== "OTHERS"');
			expect(html1109).toContain('d.deckTypeCode !== "unknown"');
			expect(html1109).toContain("curBeijingHalfYear");
		});
	});
});
