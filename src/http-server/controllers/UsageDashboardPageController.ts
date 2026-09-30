import { Request, Response } from "express";
import { config } from "src/config";

export function renderUsageDashboardPage(formatId: string): string {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Nostalgia Duel Server · ${formatId} 使用率</title>
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
		.btn {
			background: var(--panel-2);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: 0.4rem 0.9rem;
			cursor: pointer;
			font-size: 0.85rem;
			text-decoration: none;
			transition: background 0.2s, border-color 0.2s;
			display: inline-flex;
			align-items: center;
			gap: 0.4rem;
		}
		.btn:hover {
			background: var(--border);
			color: var(--text-bright);
		}
		.btn.primary {
			background: var(--primary);
			border-color: var(--primary);
			color: #fff;
		}
		.btn.primary:hover {
			background: var(--primary-hover);
		}
		.btn:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		main {
			flex: 1;
			padding: 1.5rem;
			max-width: 1200px;
			width: 100%;
			margin: 0 auto;
			display: flex;
			flex-direction: column;
			gap: 1rem;
		}
		.toolbar {
			background: var(--panel);
			border: 1px solid var(--border);
			border-radius: 8px;
			padding: 0.9rem 1.2rem;
			display: flex;
			align-items: center;
			justify-content: space-between;
			flex-wrap: wrap;
			gap: 1rem;
		}
		.filter-group {
			display: flex;
			align-items: center;
			gap: 0.6rem;
		}
		label {
			font-size: 0.85rem;
			color: var(--muted);
		}
		select {
			background: var(--panel-2);
			border: 1px solid var(--border);
			color: var(--text-bright);
			border-radius: 6px;
			padding: 0.4rem 0.8rem;
			font-size: 0.85rem;
			outline: none;
		}
		.stats-card {
			background: var(--panel);
			border: 1px solid var(--border);
			border-radius: 8px;
			padding: 1rem 1.2rem;
			display: flex;
			flex-direction: column;
			gap: 0.6rem;
		}
		.stats-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
			gap: 0.8rem;
		}
		.stat-item {
			display: flex;
			flex-direction: column;
			gap: 0.2rem;
		}
		.stat-item span.label {
			font-size: 0.75rem;
			color: var(--muted);
			text-transform: uppercase;
		}
		.stat-item span.val {
			font-size: 1.1rem;
			font-weight: 600;
			color: var(--text-bright);
		}
		.notice-bar {
			display: none;
			padding: 0.6rem 0.9rem;
			border-radius: 6px;
			font-size: 0.85rem;
			background: rgba(210, 153, 34, 0.15);
			border: 1px solid var(--warning);
			color: #e3b341;
		}
		.tabs-nav {
			display: flex;
			border-bottom: 1px solid var(--border);
			gap: 0.5rem;
			overflow-x: auto;
		}
		.metric-tab {
			background: transparent;
			border: none;
			border-bottom: 2px solid transparent;
			color: var(--muted);
			padding: 0.6rem 1rem;
			font-size: 0.9rem;
			cursor: pointer;
			white-space: nowrap;
			transition: all 0.2s;
		}
		.metric-tab:hover {
			color: var(--text);
		}
		.metric-tab.active {
			color: var(--gold-soft);
			border-bottom-color: var(--gold);
			font-weight: 600;
		}
		.table-container {
			background: var(--panel);
			border: 1px solid var(--border);
			border-radius: 8px;
			overflow-x: auto;
		}
		table {
			width: 100%;
			border-collapse: collapse;
			text-align: left;
			font-size: 0.88rem;
		}
		th {
			background: var(--panel-2);
			color: var(--muted);
			font-weight: 500;
			padding: 0.75rem 1rem;
			border-bottom: 1px solid var(--border);
			white-space: nowrap;
		}
		td {
			padding: 0.75rem 1rem;
			border-bottom: 1px solid var(--border);
			color: var(--text);
			white-space: nowrap;
		}
		tr:last-child td {
			border-bottom: none;
		}
		tr:hover td {
			background: rgba(255, 255, 255, 0.02);
		}
		.rank-col {
			width: 60px;
			text-align: center;
			font-weight: 600;
		}
		.rank-1 { color: var(--rank-1); }
		.rank-2 { color: var(--rank-2); }
		.card-link {
			color: var(--text-bright);
			text-decoration: none;
			font-weight: 600;
			transition: color 0.15s ease;
		}
		.card-link:hover {
			color: var(--primary-hover);
			text-decoration: underline;
		}
		.card-id-link {
			color: var(--muted);
			font-family: monospace;
			text-decoration: none;
			transition: color 0.15s ease;
		}
		.card-id-link:hover {
			color: var(--gold-soft);
			text-decoration: underline;
		}
		.rank-3 { color: var(--rank-3); }
		.rate-bar-cell {
			display: flex;
			align-items: center;
			gap: 0.6rem;
		}
		.rate-bar-bg {
			flex: 1;
			max-width: 120px;
			height: 8px;
			background: var(--panel-2);
			border-radius: 4px;
			overflow: hidden;
		}
		.rate-bar-fill {
			height: 100%;
			background: var(--primary);
			border-radius: 4px;
		}
		.pagination-bar {
			display: flex;
			align-items: center;
			justify-content: flex-end;
			gap: 0.8rem;
			padding: 0.5rem 0;
		}
		.info-box {
			text-align: center;
			padding: 2.5rem 1rem;
			color: var(--muted);
			font-size: 0.95rem;
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
			<a href="/leaderboards/${formatId}/usage" class="tab-btn active">使用率</a>
			${formatId === "1109" ? `<a href="/leaderboards/${formatId}/deck-stats" class="tab-btn">卡组胜率</a>` : ""}
		</nav>
	</header>

	<main>
		<div class="toolbar">
			<div class="filter-group">
				<label for="select-period">统计半年度:</label>
				<select id="select-period">
					<option value="">加载半年度中...</option>
				</select>
			</div>
			<div class="filter-group">
				<button id="btn-refresh-usage" class="btn">刷新数据</button>
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
					<span class="label">有效卡组总数 (分母)</span>
					<span id="stat-total-decks" class="val">0</span>
				</div>
				<div class="stat-item">
					<span class="label">Side已知样本数</span>
					<span id="stat-side-known-decks" class="val">0</span>
				</div>
				<div class="stat-item">
					<span class="label">最近成功发布</span>
					<span id="stat-published-at" class="val">-</span>
				</div>
			</div>
			<div id="stat-notice" class="notice-bar"></div>
		</div>

		<nav class="tabs-nav">
			<button class="metric-tab active" data-metric="deck">卡组类型</button>
			<button class="metric-tab" data-metric="monster">Main 怪兽</button>
			<button class="metric-tab" data-metric="spell">Main 魔法</button>
			<button class="metric-tab" data-metric="trap">Main 陷阱</button>
			<button class="metric-tab" data-metric="extra">额外卡组</button>
			<button class="metric-tab" data-metric="side">Side 卡片</button>
		</nav>

		<div class="table-container">
			<table id="usage-table">
				<thead id="usage-table-head">
					<tr><th>排名</th><th>卡组类型</th><th>使用份数</th><th>使用率</th></tr>
				</thead>
				<tbody id="usage-table-body">
					<tr><td colspan="8" class="info-box">正在加载使用率数据...</td></tr>
				</tbody>
			</table>
		</div>

		<div class="pagination-bar">
			<button id="btn-prev-page" class="btn" disabled>上一页</button>
			<span id="page-info" style="font-size:0.85rem; color:var(--muted);">第 1 / 1 页</span>
			<button id="btn-next-page" class="btn" disabled>下一页</button>
		</div>
	</main>

	<footer>
		Nostalgia Duel Server · 怀旧决斗服务器 · 历史卡组与卡片使用率看板
	</footer>

	<script>
		var FORMAT = "${formatId}";
		var state = {
			period: "",
			metric: "deck",
			page: 1,
			pageSize: 50,
			total: 0,
			periodsList: []
		};

		function parseUrlParams() {
			var params = new URLSearchParams(window.location.search);
			var period = params.get("period");
			if (period && /^\\d{4}H[12]$/.test(period)) {
				state.period = period;
			}
			var metric = params.get("metric");
			if (["deck", "monster", "spell", "trap", "extra", "side"].indexOf(metric) !== -1) {
				state.metric = metric;
			}
			var page = parseInt(params.get("page"), 10);
			if (page && page > 0) {
				state.page = page;
			}
		}

		function syncUrl() {
			var params = new URLSearchParams();
			if (state.period) params.set("period", state.period);
			params.set("metric", state.metric);
			params.set("page", String(state.page));
			var newUrl = window.location.pathname + "?" + params.toString();
			if (window.location.search !== "?" + params.toString()) {
				history.pushState(null, "", newUrl);
			}
		}

		function updateActiveTab() {
			var tabs = document.querySelectorAll(".metric-tab");
			tabs.forEach(function(t) {
				if (t.getAttribute("data-metric") === state.metric) {
					t.classList.add("active");
				} else {
					t.classList.remove("active");
				}
			});
		}

		function fetchPeriods() {
			return fetch("/api/ladder/" + FORMAT + "/usage/periods")
				.then(function(res) {
					if (!res.ok) throw new Error("无法获取半年度列表");
					return res.json();
				})
				.then(function(data) {
					state.periodsList = data.periods || [];
					var select = document.getElementById("select-period");
					select.innerHTML = "";
					if (state.periodsList.length === 0) {
						var opt = document.createElement("option");
						opt.value = "";
						opt.textContent = "暂无可用的半年度统计";
						select.appendChild(opt);
						return;
					}
					state.periodsList.forEach(function(p) {
						var opt = document.createElement("option");
						opt.value = p.period;
						opt.textContent = p.period + (p.isFinalized ? " (已结束归档)" : " (当前半年度)");
						select.appendChild(opt);
					});
					if (!state.period && state.periodsList.length > 0) {
						state.period = state.periodsList[0].period;
					}
					select.value = state.period;
				});
		}

		function fetchUsageData() {
			var tbody = document.getElementById("usage-table-body");
			tbody.innerHTML = '<tr><td colspan="8" class="info-box">正在加载使用率数据...</td></tr>';
			var url = "/api/ladder/" + FORMAT + "/usage?metric=" + state.metric + "&page=" + state.page + "&pageSize=" + state.pageSize;
			if (state.period) {
				url += "&period=" + state.period;
			}

			fetch(url)
				.then(function(res) {
					if (res.status === 404) {
						return res.json().then(function(d) {
							throw new Error(d.error || "该半年度统计尚未生成或暂无数据");
						});
					}
					if (!res.ok) throw new Error("请求失败 (" + res.status + ")");
					return res.json();
				})
				.then(function(data) {
					renderHeaderStats(data);
					renderTable(data);
					renderPagination(data);
				})
				.catch(function(err) {
					tbody.innerHTML = '<tr><td colspan="8" class="info-box" style="color:var(--danger);">' + escapeHtml(err.message) + '</td></tr>';
					document.getElementById("page-info").textContent = "第 1 / 1 页";
					document.getElementById("btn-prev-page").disabled = true;
					document.getElementById("btn-next-page").disabled = true;
				});
		}

		function renderHeaderStats(data) {
			document.getElementById("stat-window-range").textContent = data.windowStart + " ~ " + data.windowEndExclusive;
			document.getElementById("stat-data-end").textContent = data.dataEndExclusive;
			document.getElementById("stat-total-decks").textContent = data.totalDecks;
			document.getElementById("stat-side-known-decks").textContent = data.sideKnownDecks;
			document.getElementById("stat-published-at").textContent = data.publishedAt ? new Date(data.publishedAt).toLocaleString("zh-CN") : "-";

			var notice = document.getElementById("stat-notice");
			var notices = [];

			if (data.totalDecks === 0) {
				notices.push("本半年度已生成汇总，但暂无有效初始卡组样本。");
			} else {
				if (state.metric === "side") {
					notices.push("当前为 Side 卡片榜：分母使用 Side 已知样本数 (" + data.sideKnownDecks + " 份)，不含 Side 未知快照。");
				}
			}

			var todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
			if (data.dataEndExclusive < data.windowEndExclusive && data.dataEndExclusive < todayStr) {
				notices.push("⚠️ 数据尚未更新至今日，当前统计截止于 " + data.dataEndExclusive + "。");
			} else if (data.dataEndExclusive < data.windowEndExclusive && todayStr >= data.windowEndExclusive) {
				notices.push("⚠️ 该历史半年度尚未最终补齐。");
			}

			if (notices.length > 0) {
				notice.style.display = "block";
				notice.innerHTML = notices.map(function(n) { return "<div>" + escapeHtml(n) + "</div>"; }).join("");
			} else {
				notice.style.display = "none";
			}
		}

		function renderTable(data) {
			var thead = document.getElementById("usage-table-head");
			var tbody = document.getElementById("usage-table-body");

			if (state.metric === "deck") {
				thead.innerHTML = '<tr><th class="rank-col">排名</th><th>卡组类型</th><th>使用份数</th><th style="min-width:180px;">使用率</th></tr>';
				var decks = data.decks || [];
				if (decks.length === 0) {
					tbody.innerHTML = '<tr><td colspan="4" class="info-box">暂无卡组数据</td></tr>';
					return;
				}
				var rowsHtml = "";
				decks.forEach(function(d) {
					var rankCls = d.rank === 1 ? "rank-1" : (d.rank === 2 ? "rank-2" : (d.rank === 3 ? "rank-3" : ""));
					var ratePct = d.usageRate !== null ? (d.usageRate * 100).toFixed(2) + "%" : "-";
					var barPct = d.usageRate !== null ? Math.min(100, d.usageRate * 100).toFixed(1) + "%" : "0%";
					var isNamedDeck = d.code && d.code !== "OTHERS";
					var nameHtml = isNamedDeck
						? '<a href="/leaderboards/' + FORMAT + '/deck-detail?deckTypeCode=' + encodeURIComponent(d.code) + '&period=' + encodeURIComponent(state.period) + '" class="card-link" target="_blank" rel="noopener noreferrer"><strong>' + escapeHtml(d.nameZh) + '</strong></a>'
						: '<strong>' + escapeHtml(d.nameZh) + '</strong>';
					rowsHtml += '<tr>' +
						'<td class="rank-col ' + rankCls + '">' + d.rank + '</td>' +
						'<td>' + nameHtml + '</td>' +
						'<td>' + d.deckCount + '</td>' +
						'<td><div class="rate-bar-cell"><div class="rate-bar-bg"><div class="rate-bar-fill" style="width:' + barPct + '"></div></div><span>' + ratePct + '</span></div></td>' +
					'</tr>';
				});
				tbody.innerHTML = rowsHtml;
			} else {
				thead.innerHTML = '<tr><th class="rank-col">排名</th><th>卡片名称</th><th>卡片ID</th><th>采用卡组数</th><th style="min-width:180px;">使用率</th><th>投入 1 张</th><th>投入 2 张</th><th>投入 3 张</th></tr>';
				var cards = data.cards || [];
				if (cards.length === 0) {
					tbody.innerHTML = '<tr><td colspan="8" class="info-box">暂无卡片数据</td></tr>';
					return;
				}
				var rowsHtml = "";
				cards.forEach(function(c) {
					var rankCls = c.rank === 1 ? "rank-1" : (c.rank === 2 ? "rank-2" : (c.rank === 3 ? "rank-3" : ""));
					var ratePct = c.usageRate !== null ? (c.usageRate * 100).toFixed(2) + "%" : "-";
					var barPct = c.usageRate !== null ? Math.min(100, c.usageRate * 100).toFixed(1) + "%" : "0%";
					var cardUrl = "https://ygocdb.com/card/" + encodeURIComponent(c.cardId);
					rowsHtml += '<tr>' +
						'<td class="rank-col ' + rankCls + '">' + c.rank + '</td>' +
						'<td><a href="' + cardUrl + '" target="_blank" rel="noopener noreferrer" class="card-link">' + escapeHtml(c.name) + '</a></td>' +
						'<td><a href="' + cardUrl + '" target="_blank" rel="noopener noreferrer" class="card-id-link">' + c.cardId + '</a></td>' +
						'<td>' + c.deckCount + '</td>' +
						'<td><div class="rate-bar-cell"><div class="rate-bar-bg"><div class="rate-bar-fill" style="width:' + barPct + '"></div></div><span>' + ratePct + '</span></div></td>' +
						'<td>' + c.copies1 + '</td>' +
						'<td>' + c.copies2 + '</td>' +
						'<td>' + c.copies3 + '</td>' +
					'</tr>';
				});
				tbody.innerHTML = rowsHtml;
			}
		}

		function renderPagination(data) {
			state.total = data.total || 0;
			var totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
			document.getElementById("page-info").textContent = "第 " + state.page + " / " + totalPages + " 页 (共 " + state.total + " 条)";
			document.getElementById("btn-prev-page").disabled = state.page <= 1;
			document.getElementById("btn-next-page").disabled = state.page >= totalPages;
		}

		function escapeHtml(str) {
			if (!str) return "";
			return String(str)
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;")
				.replace(/'/g, "&#039;");
		}

		document.addEventListener("DOMContentLoaded", function() {
			parseUrlParams();
			updateActiveTab();

			fetchPeriods().then(function() {
				fetchUsageData();
			});

			document.getElementById("select-period").addEventListener("change", function(e) {
				state.period = e.target.value;
				state.page = 1;
				syncUrl();
				fetchUsageData();
			});

			document.querySelectorAll(".metric-tab").forEach(function(btn) {
				btn.addEventListener("click", function() {
					var metric = btn.getAttribute("data-metric");
					if (state.metric !== metric) {
						state.metric = metric;
						state.page = 1;
						updateActiveTab();
						syncUrl();
						fetchUsageData();
					}
				});
			});

			document.getElementById("btn-refresh-usage").addEventListener("click", function() {
				fetchUsageData();
			});

			document.getElementById("btn-prev-page").addEventListener("click", function() {
				if (state.page > 1) {
					state.page--;
					syncUrl();
					fetchUsageData();
				}
			});

			document.getElementById("btn-next-page").addEventListener("click", function() {
				var totalPages = Math.ceil(state.total / state.pageSize);
				if (state.page < totalPages) {
					state.page++;
					syncUrl();
					fetchUsageData();
				}
			});

			window.addEventListener("popstate", function() {
				parseUrlParams();
				updateActiveTab();
				document.getElementById("select-period").value = state.period;
				fetchUsageData();
			});
		});
	</script>
</body>
</html>`;
}

export class UsageDashboardPageController {
	async run(req: Request, res: Response): Promise<void> {
		const formatParam = req.params.format;
		const format = Array.isArray(formatParam) ? formatParam[0] : (formatParam ?? "");

		if (format !== "1103" && format !== "1109") {
			res.status(404).send("Not Found");
			return;
		}

		const html = renderUsageDashboardPage(format);
		res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(html);
	}
}
