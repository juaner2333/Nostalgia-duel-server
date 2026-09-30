import { Request, Response } from "express";
import { config } from "src/config";
import { getNostalgiaFormat } from "@ygopro/room/domain/NostalgiaFormat";

export function renderPlayerDetailPage(formatId: string): string {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Nostalgia Duel Server · ${formatId} 玩家战绩</title>
	<style>
		:root {
			--bg: #0d1117;
			--panel: #161b22;
			--panel-2: #21262d;
			--border: #30363d;
			--gold: #d29922;
			--gold-soft: #e3b341;
			--text: #c9d1d9;
			--text-bright: #f0f6fc;
			--muted: #8b949e;
			--primary: #1f6feb;
			--primary-hover: #388bfd;
			--danger: #f85149;
			--success: #3fb950;
			--rank-1: #ffd700;
			--rank-2: #c0c0c0;
			--rank-3: #cd7f32;
		}
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body {
			color: var(--text);
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
			background: var(--bg);
			min-height: 100vh;
			display: flex;
			flex-direction: column;
		}
		header {
			background: var(--panel);
			border-bottom: 1px solid var(--border);
			padding: 1rem 1.5rem;
			display: flex;
			align-items: center;
			justify-content: space-between;
			flex-wrap: wrap;
			gap: 0.8rem;
		}
		.brand {
			font-size: 1.25rem;
			font-weight: 600;
			color: var(--gold-soft);
			display: flex;
			align-items: center;
			gap: 0.5rem;
		}
		.brand span.badge {
			font-size: 0.8rem;
			background: var(--panel-2);
			border: 1px solid var(--border);
			color: var(--text);
			padding: 0.15rem 0.5rem;
			border-radius: 6px;
		}
		main {
			flex: 1;
			padding: 1.5rem;
			width: 100%;
			max-width: 1400px;
			margin: 0 auto;
			display: flex;
			flex-direction: column;
			gap: 1.5rem;
		}
		.card {
			background: var(--panel);
			border: 1px solid var(--border);
			border-radius: 8px;
			padding: 1.25rem;
		}
		.controls-bar {
			display: flex;
			flex-wrap: wrap;
			gap: 0.75rem;
			align-items: center;
			justify-content: space-between;
		}
		.search-group {
			display: flex;
			gap: 0.5rem;
			flex: 1;
			min-width: 280px;
			max-width: 480px;
		}
		.scope-group {
			display: flex;
			gap: 0.5rem;
			align-items: center;
			flex-wrap: wrap;
		}
		input[type="text"], select {
			background: var(--bg);
			border: 1px solid var(--border);
			color: var(--text-bright);
			padding: 0.45rem 0.75rem;
			border-radius: 6px;
			font-size: 0.9rem;
			outline: none;
		}
		input[type="text"]:focus, select:focus {
			border-color: var(--primary);
		}
		.btn {
			background: var(--panel-2);
			border: 1px solid var(--border);
			color: var(--text);
			padding: 0.45rem 0.9rem;
			border-radius: 6px;
			cursor: pointer;
			font-size: 0.9rem;
			font-weight: 500;
			transition: all 0.15s ease;
		}
		.btn:hover {
			color: var(--text-bright);
			border-color: var(--muted);
		}
		.btn-primary {
			background: var(--primary);
			border-color: var(--primary);
			color: #fff;
		}
		.btn-primary:hover {
			background: var(--primary-hover);
			border-color: var(--primary-hover);
		}
		.btn.active {
			background: var(--primary);
			border-color: var(--primary);
			color: #fff;
		}
		.mode-bar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			flex-wrap: wrap;
			gap: 0.5rem;
			font-size: 0.85rem;
			padding-top: 0.5rem;
			border-top: 1px solid var(--border);
			margin-top: 0.75rem;
		}
		.badge-mode {
			display: inline-flex;
			align-items: center;
			padding: 0.2rem 0.6rem;
			border-radius: 12px;
			font-size: 0.8rem;
			font-weight: 500;
		}
		.badge-public {
			background: rgba(139, 148, 158, 0.15);
			color: var(--muted);
			border: 1px solid var(--border);
		}
		.badge-verified {
			background: rgba(63, 185, 80, 0.15);
			color: var(--success);
			border: 1px solid rgba(63, 185, 80, 0.3);
		}
		.badge-alert {
			background: rgba(248, 81, 73, 0.15);
			color: var(--danger);
			border: 1px solid rgba(248, 81, 73, 0.3);
		}
		.player-header {
			display: flex;
			align-items: baseline;
			gap: 0.75rem;
			flex-wrap: wrap;
			margin-bottom: 1.25rem;
		}
		.player-name {
			font-size: 1.6rem;
			font-weight: 700;
			color: var(--text-bright);
		}
		.player-meta {
			font-size: 0.9rem;
			color: var(--muted);
		}
		.section-title {
			font-size: 1.15rem;
			font-weight: 600;
			color: var(--text-bright);
			margin-bottom: 0.75rem;
			display: flex;
			align-items: center;
			gap: 0.5rem;
		}
		.section-tip {
			font-size: 0.85rem;
			color: var(--muted);
			margin-bottom: 0.75rem;
		}
		.metrics-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
			gap: 0.75rem;
			margin-bottom: 1.5rem;
		}
		.metric-box {
			background: var(--panel-2);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: 0.75rem 1rem;
		}
		.metric-label {
			font-size: 0.8rem;
			color: var(--muted);
			margin-bottom: 0.25rem;
		}
		.metric-val {
			font-size: 1.3rem;
			font-weight: 600;
			color: var(--text-bright);
		}
		.metric-val.rank-1 { color: var(--rank-1); }
		.metric-val.rank-2 { color: var(--rank-2); }
		.metric-val.rank-3 { color: var(--rank-3); }
		.table-container {
			overflow-x: auto;
			margin-bottom: 1.5rem;
		}
		table {
			width: 100%;
			border-collapse: collapse;
			font-size: 0.9rem;
		}
		th, td {
			padding: 0.65rem 0.75rem;
			text-align: left;
			border-bottom: 1px solid var(--border);
		}
		th {
			background: var(--panel-2);
			color: var(--muted);
			font-weight: 500;
			white-space: nowrap;
		}
		tr:hover td {
			background: rgba(255, 255, 255, 0.02);
		}
		.win-text { color: var(--success); }
		.loss-text { color: var(--danger); }
		.badge-partial {
			font-size: 0.75rem;
			background: rgba(210, 153, 34, 0.15);
			color: var(--gold);
			border: 1px solid rgba(210, 153, 34, 0.3);
			padding: 0.1rem 0.4rem;
			border-radius: 4px;
			margin-left: 0.3rem;
		}
		.chart-container {
			width: 100%;
			height: 220px;
			margin: 1rem 0;
			position: relative;
		}
		.chart-svg {
			width: 100%;
			height: 100%;
		}
		.pagination-bar {
			display: flex;
			align-items: center;
			justify-content: flex-end;
			gap: 0.75rem;
			margin-top: 1rem;
		}
		.empty-hint {
			color: var(--muted);
			text-align: center;
			padding: 2rem;
			font-size: 0.95rem;
		}
		.loading-overlay {
			display: none;
			text-align: center;
			padding: 3rem;
			color: var(--muted);
		}
	</style>
</head>
<body>
	<header>
		<div class="brand">
			<span>Nostalgia Duel Server · ${formatId} 玩家战绩</span>
			<span class="badge">${formatId}</span>
		</div>
	</header>

	<main>
		<!-- 顶部查询与周期控件 -->
		<div class="card">
			<div class="controls-bar">
				<div class="search-group">
					<input type="text" id="player-search-input" placeholder="输入玩家昵称 或 昵称$密码 (回车查询)" />
					<button class="btn btn-primary" id="btn-search-player">查询</button>
					<button class="btn" id="btn-refresh-player">刷新</button>
				</div>
				<div class="scope-group">
					<button class="btn active" id="btn-scope-season">半年赛季</button>
					<button class="btn" id="btn-scope-overall">总战绩</button>
					<div id="season-selector-wrapper" style="display: flex; gap: 0.4rem; align-items: center;">
						<select id="player-season-year"></select>
						<select id="player-season-half">
							<option value="1">上半年 (H1)</option>
							<option value="2">下半年 (H2)</option>
						</select>
						<button class="btn" id="btn-query-season">查看赛季</button>
					</div>
				</div>
			</div>
			<div class="mode-bar">
				<div id="mode-indicator" class="badge-mode badge-public">公开模式（全时期最近最多20场）</div>
				<div id="auth-alert" style="display: none;" class="badge-mode badge-alert">密码验证失败，已回退至公开模式</div>
			</div>
		</div>

		<!-- 加载中提示 -->
		<div id="loading-container" class="card loading-overlay">
			<div>正在加载战绩详情...</div>
		</div>

		<!-- 错误与未找到提示 -->
		<div id="status-container" class="card" style="display: none;">
			<div id="status-message" class="empty-hint"></div>
		</div>

		<!-- 玩家战绩主体 -->
		<div id="player-content" class="card" style="display: none;">
			<div class="player-header">
				<span class="player-name" id="display-player-name">—</span>
				<span class="player-meta" id="display-player-meta"></span>
			</div>

			<!-- 1. 总战绩 -->
			<div id="section-overall-summary">
				<div class="section-title">总战绩</div>
				<div class="metrics-grid">
					<div class="metric-box">
						<div class="metric-label">排名</div>
						<div class="metric-val" id="stat-overall-rank">—</div>
					</div>
					<div class="metric-box">
						<div class="metric-label">积分</div>
						<div class="metric-val" id="stat-overall-points">0</div>
					</div>
					<div class="metric-box">
						<div class="metric-label">场次</div>
						<div class="metric-val" id="stat-overall-matches">0 场</div>
					</div>
					<div class="metric-box">
						<div class="metric-label">胜负</div>
						<div class="metric-val" id="stat-overall-record">0 胜 0 负</div>
					</div>
					<div class="metric-box">
						<div class="metric-label">胜率</div>
						<div class="metric-val" id="stat-overall-winrate">0%</div>
					</div>
				</div>
			</div>

			<!-- 2. 总使用率 -->
			<div id="section-overall-decks">
				<div class="section-title">总使用率</div>
				<div class="section-tip">统计单位为整场 Match；先手/后手次数及先手率基于 G1 小局，未知记录不计入先手率分母，零已知先手率显示「—」</div>
				<div class="table-container">
					<table id="table-overall-decks">
						<thead>
							<tr>
								<th>卡组类型</th>
								<th>场次</th>
								<th>胜负</th>
								<th>胜率</th>
								<th>先手 / 后手次数</th>
								<th>先手率</th>
							</tr>
						</thead>
						<tbody id="tbody-overall-decks"></tbody>
					</table>
				</div>
			</div>

			<!-- 3. 所选半年战绩 (仅半年模式) -->
			<div id="section-season-summary">
				<div class="section-title" id="season-summary-title">所选半年战绩</div>
				<div class="metrics-grid">
					<div class="metric-box">
						<div class="metric-label">排名</div>
						<div class="metric-val" id="stat-season-rank">—</div>
					</div>
					<div class="metric-box">
						<div class="metric-label">积分</div>
						<div class="metric-val" id="stat-season-points">0</div>
					</div>
					<div class="metric-box">
						<div class="metric-label">场次</div>
						<div class="metric-val" id="stat-season-matches">0 场</div>
					</div>
					<div class="metric-box">
						<div class="metric-label">胜负</div>
						<div class="metric-val" id="stat-season-record">0 胜 0 负</div>
					</div>
					<div class="metric-box">
						<div class="metric-label">胜率</div>
						<div class="metric-val" id="stat-season-winrate">0%</div>
					</div>
				</div>
			</div>

			<!-- 4. 半年使用率 (仅半年模式) -->
			<div id="section-season-decks">
				<div class="section-title" id="season-decks-title">所选半年使用率</div>
				<div class="table-container">
					<table id="table-season-decks">
						<thead>
							<tr>
								<th>卡组类型</th>
								<th>场次</th>
								<th>胜负</th>
								<th>胜率</th>
								<th>先手 / 后手次数</th>
								<th>先手率</th>
							</tr>
						</thead>
						<tbody id="tbody-season-decks"></tbody>
					</table>
				</div>
			</div>

			<!-- 5. 积分变化 -->
			<div id="section-rating-trend">
				<div class="section-title">积分变化</div>
				<div class="section-tip">走势以当前环境玩家当前总积分为终点，按全时期最近最多二十场记录向前倒推绘制（全时期数据，不受半年赛季选择影响）</div>
				<div class="chart-container" id="chart-container"></div>
			</div>

			<!-- 6. 最近战绩 (独立卡片) -->
			<div id="section-matches" style="margin-top: 1.5rem;">
				<div class="section-title">
					<span>最近战绩</span>
					<span id="history-mode-desc" class="badge-mode badge-public" style="margin-left: 0.5rem;">全时期公开最近 20 场</span>
				</div>
				<div class="table-container">
					<table id="table-matches">
						<thead>
							<tr>
								<th>时间</th>
								<th>对手</th>
								<th>胜负</th>
								<th>比分</th>
								<th>G1先后手</th>
								<th>双方卡组</th>
								<th>积分变化及结算后总积分</th>
								<th>双方卡组下载</th>
								<th>小局录像</th>
							</tr>
						</thead>
						<tbody id="tbody-matches"></tbody>
					</table>
				</div>
				<div class="pagination-bar" id="history-pagination">
					<span id="history-page-info" style="font-size: 0.85rem; color: var(--muted);">第 1 页</span>
					<button class="btn" id="btn-prev-history" disabled>上一页</button>
					<button class="btn" id="btn-next-history" disabled>下一页</button>
				</div>
			</div>
		</div>
	</main>

	<script>
		(function () {
			var FORMAT = "${formatId}";
			var state = {
				player: "",
				scope: "season",
				season: "",
				page: 1,
				requestId: 0
			};
			var memoryPassword = "";

			function getBeijingHalfYear() {
				var now = new Date();
				var formatter = new Intl.DateTimeFormat("en-CA", {
					timeZone: "Asia/Shanghai",
					year: "numeric",
					month: "2-digit"
				});
				var parts = formatter.formatToParts(now);
				var year = 2026;
				var month = 1;
				for (var i = 0; i < parts.length; i++) {
					if (parts[i].type === "year") year = parseInt(parts[i].value, 10);
					if (parts[i].type === "month") month = parseInt(parts[i].value, 10);
				}
				var half = month <= 6 ? 1 : 2;
				return { year: year, half: half, label: year + "H" + half };
			}

			function initSeasonSelectors() {
				var current = getBeijingHalfYear();
				var yearSelect = document.getElementById("player-season-year");
				yearSelect.innerHTML = "";
				for (var y = current.year; y >= current.year - 3; y--) {
					var opt = document.createElement("option");
					opt.value = String(y);
					opt.textContent = y + " 年";
					yearSelect.appendChild(opt);
				}
				yearSelect.value = String(current.year);
				document.getElementById("player-season-half").value = String(current.half);
				state.season = current.label;
			}

			function parseUrlParams() {
				var params = new URLSearchParams(window.location.search);
				var player = (params.get("player") || "").trim();
				var scope = params.get("scope");
				if (scope !== "overall" && scope !== "season") scope = "season";
				var season = params.get("season");
				var page = parseInt(params.get("page"), 10);
				if (isNaN(page) || page < 1) page = 1;

				state.player = player;
				state.scope = scope;
				state.page = page;

				if (scope === "season") {
					if (season && /^(\\d{4})H([12])$/.test(season)) {
						state.season = season;
						var match = season.match(/^(\\d{4})H([12])$/);
						if (match) {
							document.getElementById("player-season-year").value = match[1];
							document.getElementById("player-season-half").value = match[2];
						}
					} else {
						state.season = getBeijingHalfYear().label;
					}
				} else {
					state.season = "";
				}

				document.getElementById("player-search-input").value = player;
				updateScopeButtons();
			}

			function updateScopeButtons() {
				var btnSeason = document.getElementById("btn-scope-season");
				var btnOverall = document.getElementById("btn-scope-overall");
				var wrapper = document.getElementById("season-selector-wrapper");
				if (state.scope === "overall") {
					btnOverall.className = "btn active";
					btnSeason.className = "btn";
					wrapper.style.display = "none";
				} else {
					btnSeason.className = "btn active";
					btnOverall.className = "btn";
					wrapper.style.display = "flex";
				}
			}

			function syncUrl() {
				var params = new URLSearchParams();
				if (state.player) params.set("player", state.player);
				params.set("scope", state.scope);
				if (state.scope === "season" && state.season) params.set("season", state.season);
				if (state.page > 1) params.set("page", String(state.page));
				var newUrl = window.location.pathname + "?" + params.toString();
				history.replaceState(null, "", newUrl);
			}

			function renderDeckTable(tbodyId, decks) {
				var tbody = document.getElementById(tbodyId);
				tbody.innerHTML = "";
				if (!decks || decks.length === 0) {
					var tr = document.createElement("tr");
					var td = document.createElement("td");
					td.colSpan = 6;
					td.className = "empty-hint";
					td.textContent = "暂无卡组使用记录";
					tr.appendChild(td);
					tbody.appendChild(tr);
					return;
				}

				for (var i = 0; i < decks.length; i++) {
					var d = decks[i];
					var tr = document.createElement("tr");

					var tdName = document.createElement("td");
					tdName.textContent = d.deckTypeName || d.deckTypeCode;
					tr.appendChild(tdName);

					var tdMatches = document.createElement("td");
					tdMatches.textContent = d.matches + " 场";
					tr.appendChild(tdMatches);

					var tdRecord = document.createElement("td");
					tdRecord.textContent = d.wins + " 胜 " + d.losses + " 负";
					tr.appendChild(tdRecord);

					var tdWinRate = document.createElement("td");
					tdWinRate.textContent = (d.winRate * 100).toFixed(1) + "%";
					tr.appendChild(tdWinRate);

					var tdCounts = document.createElement("td");
					tdCounts.textContent = d.firstCount + " / " + d.secondCount;
					tr.appendChild(tdCounts);

					var tdRate = document.createElement("td");
					tdRate.textContent = d.firstRate !== null ? (d.firstRate * 100).toFixed(1) + "%" : "—";
					tr.appendChild(tdRate);

					tbody.appendChild(tr);
				}
			}

			function renderRatingChart(points) {
				var container = document.getElementById("chart-container");
				container.innerHTML = "";
				if (!points || points.length === 0) {
					container.innerHTML = '<div class="empty-hint">暂无比赛走势数据</div>';
					return;
				}

				var width = container.clientWidth || 800;
				var height = 200;
				var padding = 40;

				var pts = points.map(function (p) { return p.points; });
				var minPt = Math.min.apply(null, pts);
				var maxPt = Math.max.apply(null, pts);
				if (minPt === maxPt) {
					minPt -= 5;
					maxPt += 5;
				}

				var xStep = (width - padding * 2) / Math.max(points.length - 1, 1);
				var coords = [];
				for (var i = 0; i < points.length; i++) {
					var x = padding + i * xStep;
					var norm = (points[i].points - minPt) / (maxPt - minPt);
					var y = height - padding - norm * (height - padding * 2);
					coords.push({ x: x, y: y, pt: points[i] });
				}

				var pathD = "M " + coords[0].x + " " + coords[0].y;
				for (var j = 1; j < coords.length; j++) {
					pathD += " L " + coords[j].x + " " + coords[j].y;
				}

				var svg = '<svg class="chart-svg" viewBox="0 0 ' + width + ' ' + height + '">';
				svg += '<line x1="' + padding + '" y1="' + (height - padding) + '" x2="' + (width - padding) + '" y2="' + (height - padding) + '" stroke="var(--border)" stroke-width="1" />';
				svg += '<path d="' + pathD + '" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />';

				for (var k = 0; k < coords.length; k++) {
					var c = coords[k];
					var isLast = k === coords.length - 1;
					var fill = isLast ? "var(--gold)" : "var(--primary-hover)";
					var r = isLast ? 5 : 3.5;
					svg += '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + r + '" fill="' + fill + '" stroke="var(--panel)" stroke-width="1.5" />';
					svg += '<text x="' + c.x + '" y="' + (c.y - 8) + '" fill="var(--text)" font-size="11" text-anchor="middle">' + c.pt.points + '</text>';
				}
				svg += '</svg>';
				container.innerHTML = svg;
			}

			function renderMatchesTable(matches) {
				var tbody = document.getElementById("tbody-matches");
				tbody.innerHTML = "";
				if (!matches || matches.length === 0) {
					var tr = document.createElement("tr");
					var td = document.createElement("td");
					td.colSpan = 9;
					td.className = "empty-hint";
					td.textContent = "暂无对战记录";
					tr.appendChild(td);
					tbody.appendChild(tr);
					return;
				}

				for (var i = 0; i < matches.length; i++) {
					var m = matches[i];
					var tr = document.createElement("tr");

					// 1. 时间
					var tdTime = document.createElement("td");
					var dStr = m.date.replace("T", " ").slice(0, 16);
					tdTime.textContent = dStr;
					tr.appendChild(tdTime);

					// 2. 对手（在新标签页打开对手详情页）
					var tdOpp = document.createElement("td");
					if (m.opponentCanJump) {
						var aOpp = document.createElement("a");
						aOpp.style.color = "var(--primary-hover)";
						aOpp.style.textDecoration = "none";
						aOpp.href = "/leaderboards/" + FORMAT + "/player?player=" + encodeURIComponent(m.opponentUsername) + "&scope=" + state.scope + (state.season ? "&season=" + encodeURIComponent(state.season) : "");
						aOpp.target = "_blank";
						aOpp.rel = "noopener noreferrer";
						aOpp.textContent = m.opponentUsername;
						tdOpp.appendChild(aOpp);
					} else {
						tdOpp.textContent = m.opponentUsername;
					}
					tr.appendChild(tdOpp);

					// 3. 胜负
					var tdWin = document.createElement("td");
					tdWin.textContent = m.winner ? "胜利" : "失败";
					tdWin.className = m.winner ? "win-text" : "loss-text";
					tr.appendChild(tdWin);

					// 4. 比分
					var tdScore = document.createElement("td");
					tdScore.textContent = m.playerScore + " : " + m.opponentScore;
					tr.appendChild(tdScore);

					// 5. G1先后手
					var tdG1 = document.createElement("td");
					tdG1.textContent = m.g1First === true ? "先手" : (m.g1First === false ? "后手" : "未知");
					tr.appendChild(tdG1);

					// 6. 双方卡组
					var tdDecks = document.createElement("td");
					tdDecks.textContent = m.playerDeckTypeName + " vs " + m.opponentDeckTypeName;
					tr.appendChild(tdDecks);

					// 7. 积分变化及结算后总积分（仅展示当前详情页玩家）
					var tdPoints = document.createElement("td");
					var pChange = (m.playerPointsChange >= 0 ? "+" : "") + m.playerPointsChange;
					tdPoints.textContent = pChange + " (" + m.playerSettledPoints + ")";
					tr.appendChild(tdPoints);

					// 8. 双方卡组下载（分别展示本方与对手的 .ydk 下载入口与快照完整性状态）
					var tdDownloads = document.createElement("td");
					var dlBox = document.createElement("div");
					dlBox.style.display = "flex";
					dlBox.style.flexDirection = "column";
					dlBox.style.gap = "4px";

					function appendDeckDownloadEntry(label, deck) {
						var row = document.createElement("div");
						row.style.display = "flex";
						row.style.alignItems = "center";
						row.style.gap = "6px";
						row.style.whiteSpace = "nowrap";

						var spLabel = document.createElement("span");
						spLabel.style.fontSize = "0.75rem";
						spLabel.style.color = "var(--muted)";
						spLabel.textContent = label + ":";
						row.appendChild(spLabel);

						if (deck && deck.hasSnapshot && deck.downloadUrl) {
							var aLink = document.createElement("a");
							aLink.href = deck.downloadUrl;
							aLink.textContent = "下载 .ydk";
							aLink.style.color = "var(--primary-hover)";
							aLink.style.textDecoration = "none";
							row.appendChild(aLink);

							if (deck.isPartial) {
								var spPartial = document.createElement("span");
								spPartial.className = "badge-partial";
								spPartial.textContent = "部分卡组";
								row.appendChild(spPartial);
							}
						} else {
							var spNo = document.createElement("span");
							spNo.style.color = "var(--muted)";
							spNo.style.fontSize = "0.85rem";
							spNo.textContent = "无快照";
							row.appendChild(spNo);
						}
						dlBox.appendChild(row);
					}

					appendDeckDownloadEntry("本方", m.playerDeck);
					appendDeckDownloadEntry("对手", m.opponentDeck);
					tdDownloads.appendChild(dlBox);
					tr.appendChild(tdDownloads);

					// 9. 小局录像
					var tdReplays = document.createElement("td");
					if (m.duels && m.duels.length > 0) {
						for (var di = 0; di < m.duels.length; di++) {
							var duel = m.duels[di];
							if (di > 0) tdReplays.appendChild(document.createTextNode(" · "));
							var aRep = document.createElement("a");
							aRep.href = duel.downloadUrl;
							aRep.textContent = "G" + duel.duelIndex + " 录像";
							aRep.style.color = "var(--primary-hover)";
							aRep.style.textDecoration = "none";
							tdReplays.appendChild(aRep);
						}
					} else {
						tdReplays.textContent = "—";
					}
					tr.appendChild(tdReplays);

					tbody.appendChild(tr);
				}
			}

			function queryPlayer() {
				if (!state.player) {
					document.getElementById("status-container").style.display = "block";
					document.getElementById("status-message").textContent = "请输入玩家昵称进行查询";
					document.getElementById("player-content").style.display = "none";
					return;
				}

				syncUrl();
				var reqId = ++state.requestId;
				document.getElementById("loading-container").style.display = "block";
				document.getElementById("status-container").style.display = "none";
				document.getElementById("player-content").style.display = "none";

				var bodyPayload = {
					player: state.player,
					scope: state.scope,
					season: state.scope === "season" ? state.season : undefined,
					password: memoryPassword || undefined,
					page: state.page
				};

				fetch("/api/ladder/" + FORMAT + "/player", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(bodyPayload)
				})
				.then(function (res) {
					if (res.status === 429) {
						throw new Error("密码验证尝试过于频繁，请稍后再试");
					}
					return res.json();
				})
				.then(function (json) {
					if (reqId !== state.requestId) return;
					document.getElementById("loading-container").style.display = "none";

					if (!json.success || !json.data || !json.data.found) {
						document.getElementById("status-container").style.display = "block";
						document.getElementById("status-message").textContent = "未找到该玩家";
						document.getElementById("player-content").style.display = "none";
						return;
					}

					var data = json.data;
					document.getElementById("player-content").style.display = "block";

					// 模式指示器
					var modeIndicator = document.getElementById("mode-indicator");
					var authAlert = document.getElementById("auth-alert");
					var historyModeDesc = document.getElementById("history-mode-desc");

					if (data.isVerified) {
						modeIndicator.className = "badge-mode badge-verified";
						modeIndicator.textContent = "本人验证模式（支持全时期完整对战历史翻页）";
						historyModeDesc.className = "badge-mode badge-verified";
						historyModeDesc.textContent = "全时期完整对战历史";
						authAlert.style.display = "none";
					} else {
						modeIndicator.className = "badge-mode badge-public";
						modeIndicator.textContent = "公开模式（全时期最近最多20场）";
						historyModeDesc.className = "badge-mode badge-public";
						historyModeDesc.textContent = "全时期公开最近 20 场";
						if (data.authFailed) {
							authAlert.style.display = "inline-flex";
						} else {
							authAlert.style.display = "none";
						}
					}

					// 玩家标头
					document.getElementById("display-player-name").textContent = data.player;
					document.getElementById("display-player-meta").textContent = FORMAT + " · " + (data.scope === "season" ? (data.season || "") : "全时期总战绩");

					// 总战绩
					var ov = data.overallSummary || { rank: null, points: 0, matches: 0, wins: 0, losses: 0, winRate: 0 };
					var rankEl = document.getElementById("stat-overall-rank");
					rankEl.textContent = ov.rank ? ("第 " + ov.rank + " 名") : "未上榜";
					rankEl.className = "metric-val" + (ov.rank === 1 ? " rank-1" : (ov.rank === 2 ? " rank-2" : (ov.rank === 3 ? " rank-3" : "")));
					document.getElementById("stat-overall-points").textContent = String(ov.points);
					document.getElementById("stat-overall-matches").textContent = ov.matches + " 场";
					document.getElementById("stat-overall-record").textContent = ov.wins + " 胜 " + ov.losses + " 负";
					document.getElementById("stat-overall-winrate").textContent = (ov.winRate * 100).toFixed(1) + "%";

					// 总使用率表格
					renderDeckTable("tbody-overall-decks", data.overallDeckStats);

					// 半年模块展示与隐藏
					var secSeasonSummary = document.getElementById("section-season-summary");
					var secSeasonDecks = document.getElementById("section-season-decks");

					if (data.scope === "season") {
						secSeasonSummary.style.display = "block";
						secSeasonDecks.style.display = "block";
						document.getElementById("season-summary-title").textContent = (data.season || "") + " 战绩";
						document.getElementById("season-decks-title").textContent = (data.season || "") + " 使用率";

						var sn = data.seasonSummary || { rank: null, points: 0, matches: 0, wins: 0, losses: 0, winRate: 0 };
						var sRankEl = document.getElementById("stat-season-rank");
						sRankEl.textContent = sn.rank ? ("第 " + sn.rank + " 名") : "未上榜";
						sRankEl.className = "metric-val" + (sn.rank === 1 ? " rank-1" : (sn.rank === 2 ? " rank-2" : (sn.rank === 3 ? " rank-3" : "")));
						document.getElementById("stat-season-points").textContent = String(sn.points);
						document.getElementById("stat-season-matches").textContent = sn.matches + " 场";
						document.getElementById("stat-season-record").textContent = sn.wins + " 胜 " + sn.losses + " 负";
						document.getElementById("stat-season-winrate").textContent = (sn.winRate * 100).toFixed(1) + "%";

						renderDeckTable("tbody-season-decks", data.seasonDeckStats || []);
					} else {
						secSeasonSummary.style.display = "none";
						secSeasonDecks.style.display = "none";
					}

					// 积分曲线
					renderRatingChart(data.ratingTrend || []);

					// 最近战绩
					renderMatchesTable(data.matches || []);

					// 分页状态
					var pagination = data.pagination || { page: 1, pageSize: 20, total: 0 };
					var totalPages = Math.ceil(pagination.total / pagination.pageSize) || 1;
					document.getElementById("history-page-info").textContent = "第 " + pagination.page + " / " + totalPages + " 页 (共 " + pagination.total + " 条)";
					document.getElementById("btn-prev-history").disabled = !data.isVerified || pagination.page <= 1;
					document.getElementById("btn-next-history").disabled = !data.isVerified || pagination.page >= totalPages;
				})
				.catch(function (err) {
					if (reqId !== state.requestId) return;
					document.getElementById("loading-container").style.display = "none";
					document.getElementById("status-container").style.display = "block";
					document.getElementById("status-message").textContent = err.message || "加载失败，请重试";
					document.getElementById("player-content").style.display = "none";
				});
			}

			function handleSearchSubmit() {
				var inputEl = document.getElementById("player-search-input");
				var rawInput = inputEl.value || "";
				var dollarIdx = rawInput.indexOf("$");
				var player = dollarIdx >= 0 ? rawInput.slice(0, dollarIdx).trim() : rawInput.trim();
				var password = dollarIdx >= 0 ? rawInput.slice(dollarIdx + 1) : "";

				if (!player) {
					alert("请输入玩家昵称");
					return;
				}

				// 提交后输入框只保留昵称
				inputEl.value = player;
				state.player = player;
				state.page = 1;
				memoryPassword = password; // 仅存当前闭包内存

				queryPlayer();
			}

			// 事件绑定
			document.getElementById("btn-search-player").addEventListener("click", handleSearchSubmit);
			document.getElementById("player-search-input").addEventListener("keydown", function (ev) {
				if (ev.key === "Enter") {
					handleSearchSubmit();
				}
			});

			document.getElementById("btn-refresh-player").addEventListener("click", function () {
				queryPlayer();
			});

			document.getElementById("btn-scope-season").addEventListener("click", function () {
				if (state.scope !== "season") {
					state.scope = "season";
					state.season = document.getElementById("player-season-year").value + "H" + document.getElementById("player-season-half").value;
					updateScopeButtons();
					queryPlayer();
				}
			});

			document.getElementById("btn-scope-overall").addEventListener("click", function () {
				if (state.scope !== "overall") {
					state.scope = "overall";
					state.season = "";
					updateScopeButtons();
					queryPlayer();
				}
			});

			document.getElementById("btn-query-season").addEventListener("click", function () {
				state.scope = "season";
				state.season = document.getElementById("player-season-year").value + "H" + document.getElementById("player-season-half").value;
				updateScopeButtons();
				queryPlayer();
			});

			document.getElementById("btn-prev-history").addEventListener("click", function () {
				if (state.page > 1) {
					state.page -= 1;
					queryPlayer();
				}
			});

			document.getElementById("btn-next-history").addEventListener("click", function () {
				state.page += 1;
				queryPlayer();
			});

			// 初始化执行
			initSeasonSelectors();
			parseUrlParams();
			if (state.player) {
				queryPlayer();
			}
		})();
	</script>
</body>
</html>`;
}

export class PlayerDetailPageController {
	run(req: Request, res: Response): void {
		if (!config.ranking.enabled) {
			res.status(503).json({
				error: "Player detail page is currently unavailable (ranking disabled)",
			});
			return;
		}

		const formatParam = req.params.format;
		const format = Array.isArray(formatParam) ? formatParam[0] : (formatParam ?? "");

		if (!getNostalgiaFormat(format)) {
			res.status(404).json({
				error: `Unknown format: ${format}`,
			});
			return;
		}

		res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
		res.setHeader("Pragma", "no-cache");
		res.setHeader("Expires", "0");

		const html = renderPlayerDetailPage(format);
		res.type("html").status(200).send(html);
	}
}
