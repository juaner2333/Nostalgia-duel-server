import { renderLeaderboardPage } from "./LeaderboardPageController";

describe("LeaderboardPage client-side scripts and behavior specification", () => {
	const html1103 = renderLeaderboardPage("1103");
	const html1109 = renderLeaderboardPage("1109");

	describe("Tab 1: 房间列表 (Rooms list)", () => {
		it("filters rooms by formatId matching page format", () => {
			expect(html1103).toContain("String(r.formatId) === FORMAT");
			expect(html1103).toContain('var FORMAT = "1103";');
			expect(html1109).toContain('var FORMAT = "1109";');
		});

		it("displays statistics line: total rooms, dueling count, online players, update time", () => {
			expect(html1103).toContain('id="stat-total"');
			expect(html1103).toContain('id="stat-dueling"');
			expect(html1103).toContain('id="stat-players"');
			expect(html1103).toContain('id="stat-updated"');
		});

		it("displays '等待匹配中' for unstarted ranked rooms without leaking players", () => {
			expect(html1103).toContain('r.istart === "start"');
			expect(html1103).toContain("isRanked && !isDueling");
			expect(html1103).toContain("等待匹配中");
		});

		it("formats spectator copy target as format#TT<roomid> for ranked rooms and format#roomId for normal rooms", () => {
			expect(html1103).toContain('FORMAT + "#TT" + r.roomid');
			expect(html1103).toContain('r.roomname || (FORMAT + "#" + r.roomid)');
			expect(html1103).toContain("复制观战号");
			expect(html1103).toContain("复制房间名");
		});

		it("provides manual refresh button without auto polling", () => {
			expect(html1103).toContain('id="btn-refresh-rooms"');
			expect(html1103).not.toContain("setInterval");
		});
	});

	describe("Tab 2: 录像下载 (Replays tab)", () => {
		it("paginates at 20 items per page", () => {
			expect(html1103).toContain("pageSize: 20");
		});

		it("contains search box, search button, clear button and refresh button", () => {
			expect(html1103).toContain('id="replays-search-input"');
			expect(html1103).toContain('id="btn-search-replays"');
			expect(html1103).toContain('id="btn-clear-replays"');
			expect(html1103).toContain('id="btn-refresh-replays"');
		});

		it("links download directly to /api/replays/:format/:replayId", () => {
			expect(html1103).toContain(
				'"/api/replays/" + FORMAT + "/" + encodeURIComponent(rep.replayId)',
			);
			expect(html1103).toContain("下载 .yrp");
		});

		it("disables prev button on first page and next button on last page", () => {
			expect(html1103).toContain(
				'document.getElementById("btn-prev-replays").disabled = replaysState.page <= 1;',
			);
			expect(html1103).toContain(
				'document.getElementById("btn-next-replays").disabled = replaysState.page >= totalPages;',
			);
		});
	});

	describe("Tab 3: 天梯排行 (Ladder tab)", () => {
		it("calculates initial month in Asia/Shanghai timezone", () => {
			expect(html1103).toContain('timeZone: "Asia/Shanghai"');
			expect(html1103).toContain("getBeijingMonth()");
		});

		it("switches between monthly season and overall total ladder", () => {
			expect(html1103).toContain('id="btn-scope-season"');
			expect(html1103).toContain('id="btn-scope-overall"');
			expect(html1103).toContain('ladderState.scope = "season"');
			expect(html1103).toContain('ladderState.scope = "overall"');
		});

		it("omits season parameter for overall scope", () => {
			expect(html1103).toContain('if (ladderState.scope === "season" && ladderState.season)');
		});

		it("paginates at 50 items per page", () => {
			expect(html1103).toContain("pageSize: 50");
		});

		it("masks usernames in the bottom 30% (rank/total >= 0.7) when no search keyword", () => {
			expect(html1103).toContain(
				"!ladderState.search && totalCount > 0 && (entry.rank / totalCount >= 0.7)",
			);
			expect(html1103).toContain('"******"');
		});

		it("highlights top 3 ranks with distinct styling classes", () => {
			expect(html1103).toContain('if (entry.rank === 1) tdRank.className = "rank-1";');
			expect(html1103).toContain('else if (entry.rank === 2) tdRank.className = "rank-2";');
			expect(html1103).toContain('else if (entry.rank === 3) tdRank.className = "rank-3";');
		});

		it("calculates total matches as wins + losses", () => {
			expect(html1103).toContain("(entry.wins || 0) + (entry.losses || 0)");
		});

		it("serves season-parsing regexes with intact backslash digit escapes", () => {
			expect(html1103).toContain("/^(\\d{4})[^\\d]?(\\d{1,2})[^\\d]?$/");
			expect(html1103).toContain("/^(\\d{4})[^\\d]+(\\d{1,2})/");
			expect(html1103).toContain("/^(\\d{2})[^\\d]+(\\d{1,2})/");
			expect(html1103).toContain("/^(\\d{4})(\\d{2})$/");
			expect(html1103).toContain("/^\\d{4}$/.test(y) && /^\\d{2}$/.test(m)");
		});
	});

	describe("State isolation, request sequence, and XSS safety", () => {
		it("uses incrementing requestId per tab to prevent race condition overrides", () => {
			expect(html1103).toContain("var reqId = ++roomsState.requestId;");
			expect(html1103).toContain("if (reqId !== roomsState.requestId) return;");
			expect(html1103).toContain("var reqId = ++replaysState.requestId;");
			expect(html1103).toContain("if (reqId !== replaysState.requestId) return;");
			expect(html1103).toContain("var reqId = ++ladderState.requestId;");
			expect(html1103).toContain("if (reqId !== ladderState.requestId) return;");
		});

		it("writes user-controlled data via textContent rather than innerHTML", () => {
			expect(html1103).toContain('tdPlayer.textContent = isMasked ? "******" : entry.username;');
			expect(html1103).toContain('tdName.textContent = r.roomname || "-";');
			expect(html1103).toContain('tdPlayers.textContent = userNames || "无玩家";');
		});

		it("does not render or expose userId in ladder or replay tables", () => {
			expect(html1103).not.toContain("entry.userId");
			expect(html1103).not.toContain("entry.user_id");
		});
	});
});
