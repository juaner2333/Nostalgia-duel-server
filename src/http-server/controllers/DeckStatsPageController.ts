import { Request, Response } from "express";

export function renderDeckStatsPage(formatId: string): string {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Nostalgia Duel Server · ${formatId} 卡组胜率</title>
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
			--warning: #d29922;
			--success: #3fb950;
			--win-high: #238636;
			--win-low: #da3633;
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
			gap: 1rem;
		}
		.brand {
			font-size: 1.25rem;
			font-weight: 600;
			color: var(--gold-soft);
			display: flex;
			align-items: center;
			gap: 0.5rem;
		}
		.badge {
			font-size: 0.8rem;
			background: var(--panel-2);
			border: 1px solid var(--border);
			color: var(--text);
			padding: 0.15rem 0.5rem;
			border-radius: 6px;
		}
		.tabs {
			display: flex;
			gap: 0.5rem;
			background: var(--panel-2);
			padding: 0.25rem;
			border-radius: 8px;
			border: 1px solid var(--border);
		}
		.tab-btn {
			background: transparent;
			border: none;
			color: var(--muted);
			padding: 0.45rem 1rem;
			border-radius: 6px;
			cursor: pointer;
			font-size: 0.9rem;
			font-weight: 500;
			transition: all 0.15s ease;
			text-decoration: none;
			display: inline-flex;
			align-items: center;
		}
		.tab-btn:hover {
			color: var(--text-bright);
		}
		.tab-btn.active {
			background: var(--primary);
			color: #fff;
		}
		main {
			flex: 1;
			padding: 1.5rem;
			max-width: 100%;
			margin: 0;
			width: 100%;
		}
		.toolbar {
			display: flex;
			justify-content: space-between;
			align-items: center;
			flex-wrap: wrap;
			gap: 1rem;
			margin-bottom: 1rem;
		}
		.filter-group {
			display: flex;
			align-items: center;
			gap: 0.6rem;
			flex-wrap: wrap;
		}
		.view-tabs {
			display: flex;
			background: var(--panel-2);
			padding: 0.25rem;
			border-radius: 6px;
			border: 1px solid var(--border);
			gap: 0.25rem;
		}
		.view-btn {
			background: transparent;
			border: none;
			color: var(--muted);
			padding: 0.4rem 0.85rem;
			font-size: 0.85rem;
			border-radius: 4px;
			cursor: pointer;
			transition: all 0.15s ease;
		}
		.view-btn:hover {
			color: var(--text-bright);
		}
		.view-btn.active {
			background: var(--primary);
			color: #fff;
			font-weight: 600;
		}
		select {
			background: var(--panel);
			color: var(--text-bright);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: 0.4rem 1.8rem 0.4rem 0.75rem;
			font-size: 0.85rem;
			outline: none;
			cursor: pointer;
			appearance: none;
			-webkit-appearance: none;
			-moz-appearance: none;
			background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%),
			                  linear-gradient(135deg, var(--muted) 50%, transparent 50%);
			background-position: calc(100% - 16px) calc(50% - 2px), calc(100% - 11px) calc(50% - 2px);
			background-size: 4px 4px, 4px 4px;
			background-repeat: no-repeat;
		}
		select:focus {
			border-color: var(--primary);
		}
		select option {
			background: var(--panel-2);
			color: var(--text-bright);
		}
		.btn {
			background: var(--panel-2);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: 0.4rem 0.9rem;
			font-size: 0.85rem;
			cursor: pointer;
			transition: all 0.15s;
		}
		.btn:hover {
			background: var(--border);
			color: var(--text-bright);
		}
		.stats-card {
			background: var(--panel);
			border: 1px solid var(--border);
			border-radius: 8px;
			padding: 1rem;
			margin-bottom: 1rem;
		}
		.stats-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
			gap: 1rem;
		}
		.stat-item {
			display: flex;
			flex-direction: column;
			gap: 0.25rem;
		}
		.stat-item .label {
			font-size: 0.8rem;
			color: var(--muted);
		}
		.stat-item .val {
			font-size: 1.1rem;
			font-weight: 600;
			color: var(--text-bright);
		}
		.notice-box {
			background: rgba(31, 111, 235, 0.1);
			border: 1px solid rgba(56, 139, 253, 0.3);
			color: var(--text);
			padding: 0.6rem 0.9rem;
			border-radius: 6px;
			font-size: 0.85rem;
			margin-top: 0.8rem;
		}
		.table-container {
			background: var(--panel);
			border: 1px solid var(--border);
			border-radius: 8px;
			overflow-x: auto;
			margin-bottom: 1rem;
			max-width: 100%;
		}
		table {
			width: 100%;
			border-collapse: separate;
			border-spacing: 0;
			text-align: center;
			font-size: 0.82rem;
		}
		th, td {
			padding: 0.65rem 0.55rem;
			border-bottom: 1px solid var(--border);
			border-right: 1px solid var(--border);
			white-space: nowrap;
		}
		th {
			background: var(--panel-2);
			color: var(--text-bright);
			font-weight: 600;
			position: sticky;
			top: 0;
			z-index: 2;
		}
		th.corner-header {
			left: 0;
			z-index: 3;
			min-width: 130px;
		}
		th.row-header {
			position: sticky;
			left: 0;
			z-index: 1;
			text-align: left;
			padding-left: 0.75rem;
			background: var(--panel-2);
			min-width: 130px;
			max-width: 160px;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		th.total-col-header, td.total-col-cell {
			background: rgba(210, 153, 34, 0.08);
			font-weight: 600;
		}
		td {
			color: var(--text);
			min-width: 82px;
		}
		td.diagonal-cell {
			background: rgba(255, 255, 255, 0.02);
		}
		tr:last-child th, tr:last-child td {
			border-bottom: none;
		}
		tr:hover td {
			background: rgba(255, 255, 255, 0.04);
		}
		.winrate-val {
			font-size: 0.88rem;
			font-weight: 600;
		}
		.winrate-high {
			color: var(--success);
		}
		.winrate-low {
			color: var(--danger);
		}
		.winrate-mid {
			color: var(--gold-soft);
		}
		.match-counts {
			font-size: 0.72rem;
			color: var(--muted);
			margin-top: 2px;
		}
		.cell-nodata {
			color: var(--muted);
			font-size: 0.78rem;
		}
		.info-box {
			text-align: center;
			padding: 3rem 1rem;
			color: var(--muted);
			font-size: 0.95rem;
		}
		.info-box.error {
			color: var(--danger);
		}
		footer {
			border-top: 1px solid var(--border);
			padding: 1rem;
			text-align: center;
			color: var(--muted);
			font-size: 0.8rem;
			background: var(--panel);
		}
		@media (max-width: 768px) {
			header { flex-direction: column; align-items: stretch; }
			.tabs { justify-content: stretch; }
			.tab-btn { flex: 1; text-align: center; }
			.toolbar { flex-direction: column; align-items: stretch; }
			.filter-group { justify-content: space-between; }
			.view-tabs { width: 100%; justify-content: space-between; }
			.view-btn { flex: 1; text-align: center; }
		}
	</style>
</head>
<body>
	<header>
		<div class="brand">
			Nostalgia Duel Server
			<span class="badge">${formatId} 专区</span>
		</div>
		<nav class="tabs">
			<a href="/leaderboards/${formatId}?tab=rooms" class="tab-btn">房间列表</a>
			<a href="/leaderboards/${formatId}?tab=replays" class="tab-btn">录像下载</a>
			<a href="/leaderboards/${formatId}?tab=ladder" class="tab-btn">天梯排行</a>
			<a href="/leaderboards/${formatId}/usage" class="tab-btn">使用率</a>
			<a href="/leaderboards/${formatId}/deck-stats" class="tab-btn active">卡组胜率</a>
		</nav>
	</header>

	<main>
		<div class="toolbar">
			<div class="filter-group">
				<label for="select-period" style="font-size: 0.85rem; color: var(--muted);">统计半年度:</label>
				<select id="select-period">
					<option value="">加载半年度中...</option>
				</select>
				<button id="btn-refresh" class="btn">刷新数据</button>
			</div>
			<div class="filter-group">
				<div class="view-tabs">
					<button class="view-btn active" data-view="overall">Match 综合胜率</button>
					<button class="view-btn" data-view="first">Match 先攻胜率</button>
					<button class="view-btn" data-view="second">Match 后攻胜率</button>
				</div>
			</div>
		</div>

		<div class="stats-card">
			<div class="stats-grid">
				<div class="stat-item">
					<span class="label">统计时间范围</span>
					<span id="stat-window-range" class="val">-</span>
				</div>
				<div class="stat-item">
					<span class="label">数据实际截止</span>
					<span id="stat-data-end" class="val">-</span>
				</div>
				<div class="stat-item">
					<span class="label">入选对阵物理场数</span>
					<span id="stat-admitted-matches" class="val">0</span>
				</div>
				<div class="stat-item">
					<span class="label">最近成功发布</span>
					<span id="stat-published-at" class="val">-</span>
				</div>
			</div>
			<div id="stat-notice" class="notice-box" style="display: none;"></div>
		</div>

		<div class="table-container">
			<table id="matrix-table">
				<thead id="matrix-thead">
					<tr>
						<th class="corner-header">本方 \\ 对手</th>
					</tr>
				</thead>
				<tbody id="matrix-tbody">
					<tr>
						<td class="info-box" colspan="17">正在加载卡组胜率矩阵...</td>
					</tr>
				</tbody>
			</table>
		</div>
	</main>

	<footer>
		&copy; Nostalgia Duel Server · 1109 排位对战半年度卡组胜率矩阵
	</footer>

	<script>
		var FORMAT = "${formatId}";
		var state = {
			period: "",
			view: "overall",
			requestId: 0,
			data: null,
		};

		function escapeHtml(str) {
			if (!str) return "";
			return String(str)
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;")
				.replace(/'/g, "&#39;");
		}

		function parseUrlParams() {
			var search = new URLSearchParams(window.location.search);
			var periodParam = search.get("period");
			if (periodParam && /^(\\d{4})H([12])$/.test(periodParam)) {
				state.period = periodParam;
			}
			var viewParam = search.get("view");
			if (viewParam === "first" || viewParam === "second" || viewParam === "overall") {
				state.view = viewParam;
			}
		}

		function syncUrl() {
			var search = new URLSearchParams();
			if (state.period) search.set("period", state.period);
			if (state.view && state.view !== "overall") search.set("view", state.view);
			var newUrl = window.location.pathname + (search.toString() ? "?" + search.toString() : "");
			window.history.pushState(null, "", newUrl);
		}

		function updateViewButtons() {
			var buttons = document.querySelectorAll(".view-btn");
			buttons.forEach(function(btn) {
				if (btn.getAttribute("data-view") === state.view) {
					btn.classList.add("active");
				} else {
					btn.classList.remove("active");
				}
			});
		}

		function formatRate(wins, matches) {
			if (!matches || matches <= 0) {
				return '<span class="cell-nodata">数据不足</span>';
			}
			var pct = (wins / matches) * 100;
			var pctStr = pct.toFixed(1) + "%";
			var colorCls = "winrate-mid";
			if (pct >= 55.0) colorCls = "winrate-high";
			else if (pct <= 45.0) colorCls = "winrate-low";
			return '<div class="winrate-val ' + colorCls + '">' + pctStr + '</div>' +
				'<div class="match-counts">' + wins + '/' + matches + '</div>';
		}

		function renderStatsInfo(data) {
			document.getElementById("stat-window-range").textContent =
				(data.windowStart ? data.windowStart.slice(0, 10) : "-") +
				" ~ " +
				(data.windowEndExclusive ? data.windowEndExclusive.slice(0, 10) : "-");
			document.getElementById("stat-data-end").textContent =
				data.dataEndExclusive ? data.dataEndExclusive.slice(0, 10) : "-";
			document.getElementById("stat-admitted-matches").textContent =
				(data.totalPhysicalMatches || 0).toLocaleString();
			document.getElementById("stat-published-at").textContent =
				data.publishedAt ? new Date(data.publishedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-";

			var notice = document.getElementById("stat-notice");
			if (data.dataEndExclusive && data.windowEndExclusive && data.dataEndExclusive < data.windowEndExclusive) {
				notice.style.display = "block";
				notice.textContent = "提示：当前展示截至 " + data.dataEndExclusive.slice(0, 10) + " 的排位对局统计，每日 03:00 自动重建。";
			} else {
				notice.style.display = "none";
			}
		}

		function renderMatrix(data) {
			var thead = document.getElementById("matrix-thead");
			var tbody = document.getElementById("matrix-tbody");
			var decks = data.decks || [];

			if (decks.length === 0) {
				thead.innerHTML = '<tr><th class="corner-header">本方 \\ 对手</th></tr>';
				tbody.innerHTML = '<tr><td class="info-box">暂无对阵数据</td></tr>';
				return;
			}

			// Render header
			var headerHtml = '<tr><th class="corner-header">本方 \\ 对手</th>';
			for (var i = 0; i < decks.length; i++) {
				headerHtml += '<th title="' + escapeHtml(decks[i].nameZh) + '">' + escapeHtml(decks[i].nameZh) + '</th>';
			}
			headerHtml += '<th class="total-col-header" title="仅汇总本方对入选前 15 名类别的对局">前 15 内合计</th></tr>';
			thead.innerHTML = headerHtml;

			// Render rows
			var rowsHtml = "";
			var view = state.view;

			for (var r = 0; r < decks.length; r++) {
				var deckA = decks[r];
				rowsHtml += '<tr><th class="row-header" title="' + escapeHtml(deckA.nameZh) + '">' + escapeHtml(deckA.nameZh) + '</th>';
				var totalWins = 0;
				var totalMatches = 0;

				for (var c = 0; c < decks.length; c++) {
					var deckB = decks[c];
					var key = deckA.code + "_" + deckB.code;
					var stat = data.stats[key] || {
						matches: 0,
						matchWins: 0,
						firstMatches: 0,
						firstWins: 0,
						secondMatches: 0,
						secondWins: 0,
					};

					var m = 0;
					var w = 0;
					if (view === "first") {
						m = stat.firstMatches;
						w = stat.firstWins;
					} else if (view === "second") {
						m = stat.secondMatches;
						w = stat.secondWins;
					} else {
						m = stat.matches;
						w = stat.matchWins;
					}

					totalWins += w;
					totalMatches += m;

					var isDiagonal = r === c;
					var cellClass = isDiagonal ? "diagonal-cell" : "";
					rowsHtml += '<td class="' + cellClass + '">' + formatRate(w, m) + '</td>';
				}

				// Total column
				rowsHtml += '<td class="total-col-cell">' + formatRate(totalWins, totalMatches) + '</td></tr>';
			}

			tbody.innerHTML = rowsHtml;
		}

		function loadDeckStats() {
			var reqId = ++state.requestId;
			var tbody = document.getElementById("matrix-tbody");
			tbody.innerHTML = '<tr><td colspan="17" class="info-box">正在加载卡组胜率矩阵...</td></tr>';

			var url = "/api/ladder/" + FORMAT + "/deck-stats" + (state.period ? "?period=" + encodeURIComponent(state.period) : "");
			fetch(url)
				.then(function(res) {
					if (!res.ok) {
						return res.json().then(function(data) {
							throw new Error(data.error || ("HTTP " + res.status));
						}).catch(function(err) {
							throw new Error(err.message || ("HTTP " + res.status));
						});
					}
					return res.json();
				})
				.then(function(data) {
					if (reqId !== state.requestId) return;
					state.data = data;
					if (!state.period && data.period) {
						state.period = data.period;
						var sel = document.getElementById("select-period");
						if (sel) sel.value = data.period;
					}
					renderStatsInfo(data);
					renderMatrix(data);
				})
				.catch(function(err) {
					if (reqId !== state.requestId) return;
					tbody.innerHTML = '<tr><td colspan="17" class="info-box error">加载失败: ' + escapeHtml(err.message) + '</td></tr>';
				});
		}

		function loadPeriods() {
			var sel = document.getElementById("select-period");
			fetch("/api/ladder/" + FORMAT + "/deck-stats/periods")
				.then(function(res) {
					if (!res.ok) throw new Error("HTTP " + res.status);
					return res.json();
				})
				.then(function(data) {
					var periods = data.periods || [];
					if (periods.length === 0) {
						sel.innerHTML = '<option value="">暂无可用半年度</option>';
						return;
					}
					var optionsHtml = "";
					for (var i = 0; i < periods.length; i++) {
						var p = periods[i];
						var selected = (p === state.period) ? " selected" : "";
						optionsHtml += '<option value="' + escapeHtml(p) + '"' + selected + '>' + escapeHtml(p) + '</option>';
					}
					sel.innerHTML = optionsHtml;
					if (!state.period && periods.length > 0) {
						state.period = periods[0];
						sel.value = periods[0];
					}
					loadDeckStats();
				})
				.catch(function() {
					sel.innerHTML = '<option value="">半年度列表加载失败</option>';
					loadDeckStats();
				});
		}

		function setupEvents() {
			var sel = document.getElementById("select-period");
			sel.addEventListener("change", function() {
				state.period = sel.value;
				syncUrl();
				loadDeckStats();
			});

			document.getElementById("btn-refresh").addEventListener("click", function() {
				loadDeckStats();
			});

			var viewButtons = document.querySelectorAll(".view-btn");
			viewButtons.forEach(function(btn) {
				btn.addEventListener("click", function() {
					var targetView = btn.getAttribute("data-view");
					if (targetView && targetView !== state.view) {
						state.view = targetView;
						updateViewButtons();
						syncUrl();
						if (state.data) {
							renderMatrix(state.data);
						}
					}
				});
			});
		}

		document.addEventListener("DOMContentLoaded", function() {
			parseUrlParams();
			updateViewButtons();
			setupEvents();
			loadPeriods();
		});
	</script>
</body>
</html>`;
}

export class DeckStatsPageController {
	public async run(req: Request, res: Response): Promise<void> {
		const formatParam = req.params.format;
		const format = Array.isArray(formatParam) ? formatParam[0] : (formatParam ?? "");

		if (format !== "1109") {
			res.status(404).send("Not Found");
			return;
		}

		res
			.status(200)
			.setHeader("Content-Type", "text/html; charset=utf-8")
			.send(renderDeckStatsPage(format));
	}
}
