import { Request, Response } from "express";
import { config } from "src/config";
import { getNostalgiaFormat } from "@ygopro/room/domain/NostalgiaFormat";

/**
 * 渲染卡组详情 HTML 页面模板
 *
 * @param formatId 赛制环境标识（"1103" 或 "1109"）
 */
export function renderDeckDetailPage(formatId: string): string {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Nostalgia Duel Server · ${formatId} 卡组详情</title>
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
		.nav-links {
			display: flex;
			gap: 0.8rem;
			flex-wrap: wrap;
		}
		.nav-link {
			color: var(--text);
			text-decoration: none;
			font-size: 0.875rem;
			padding: 0.35rem 0.75rem;
			border-radius: 6px;
			border: 1px solid var(--border);
			background: var(--panel-2);
			transition: all 0.2s;
		}
		.nav-link:hover {
			border-color: var(--gold-soft);
			color: var(--gold-soft);
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
		.card-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			margin-bottom: 1rem;
			flex-wrap: wrap;
			gap: 0.5rem;
		}
		.card-title {
			font-size: 1.1rem;
			font-weight: 600;
			color: var(--text-bright);
		}
		.controls-row {
			display: flex;
			gap: 0.75rem;
			flex-wrap: wrap;
			align-items: center;
		}
		input[type="text"], select {
			background: var(--panel-2);
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
			color: var(--text-bright);
			padding: 0.45rem 0.9rem;
			border-radius: 6px;
			font-size: 0.9rem;
			cursor: pointer;
			transition: background 0.15s, border-color 0.15s;
		}
		.btn:hover {
			background: var(--border);
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
		.candidates-container {
			display: flex;
			flex-wrap: wrap;
			gap: 0.5rem;
			margin-top: 0.75rem;
		}
		.candidate-btn {
			font-size: 0.825rem;
			padding: 0.3rem 0.65rem;
			border-radius: 4px;
			background: var(--panel-2);
			border: 1px solid var(--border);
			color: var(--text);
			cursor: pointer;
		}
		.candidate-btn:hover {
			border-color: var(--gold-soft);
			color: var(--gold-soft);
		}
		.candidate-btn.active {
			background: var(--gold);
			border-color: var(--gold);
			color: #000;
			font-weight: 600;
		}
		.status-box {
			padding: 0.75rem 1rem;
			border-radius: 6px;
			font-size: 0.875rem;
			display: none;
		}
		.status-info {
			background: rgba(56, 139, 253, 0.15);
			border: 1px solid var(--primary);
			color: #58a6ff;
		}
		.status-error {
			background: rgba(248, 81, 73, 0.15);
			border: 1px solid var(--danger);
			color: var(--danger);
		}
		.status-empty {
			background: rgba(139, 148, 158, 0.15);
			border: 1px solid var(--border);
			color: var(--muted);
		}
		.deck-header-info {
			display: flex;
			justify-content: space-between;
			align-items: flex-start;
			flex-wrap: wrap;
			gap: 1rem;
		}
		.deck-name {
			font-size: 1.4rem;
			font-weight: 700;
			color: var(--gold-soft);
		}
		.usage-stats {
			display: flex;
			gap: 1.5rem;
			flex-wrap: wrap;
			font-size: 0.95rem;
			margin-top: 0.5rem;
		}
		.stat-tag {
			color: var(--muted);
		}
		.stat-val {
			color: var(--text-bright);
			font-weight: 600;
			margin-left: 0.25rem;
		}
		.notice-bar {
			font-size: 0.8rem;
			color: var(--muted);
			margin-top: 0.5rem;
		}
		.table-responsive {
			width: 100%;
			overflow-x: auto;
			margin-top: 0.75rem;
		}
		table {
			width: 100%;
			border-collapse: collapse;
			font-size: 0.875rem;
			text-align: left;
		}
		th, td {
			padding: 0.65rem 0.85rem;
			border-bottom: 1px solid var(--border);
			white-space: nowrap;
		}
		th {
			background: var(--panel-2);
			color: var(--muted);
			font-weight: 600;
		}
		tr:hover td {
			background: rgba(255, 255, 255, 0.02);
		}
		.total-row td {
			background: var(--panel-2);
			font-weight: 700;
			color: var(--gold-soft);
			border-top: 2px solid var(--border);
		}
		.muted {
			color: var(--muted);
		}
		.deck-link, .player-link {
			color: var(--text-bright);
			text-decoration: none;
			cursor: pointer;
		}
		.deck-link:hover, .player-link:hover {
			color: var(--primary-hover);
			text-decoration: underline;
		}
		.rank-1 { color: var(--rank-1); font-weight: 700; }
		.rank-2 { color: var(--rank-2); font-weight: 700; }
		.rank-3 { color: var(--rank-3); font-weight: 700; }
	</style>
</head>
<body>
	<header>
		<div class="brand">
			<span>Nostalgia Duel Server</span>
			<span class="badge">${formatId} 卡组详情</span>
		</div>
		<nav class="nav-links">
			<a class="nav-link" href="/leaderboards/${formatId}">决斗专区</a>
			<a class="nav-link" href="/leaderboards/${formatId}/usage">卡组使用率</a>
			<a class="nav-link" href="/leaderboards/${formatId}/deck-stats">胜率矩阵</a>
		</nav>
	</header>

	<main>
		${
			formatId === "1103"
				? `
		<div class="card">
			<div class="status-box status-empty" style="display: block;">
				当前环境暂无具名卡组分类
			</div>
		</div>
		`
				: `
		<!-- 查询与赛季选择控制卡片 -->
		<div class="card">
			<div class="controls-row">
				<input type="text" id="deck-search-input" placeholder="输入卡组中文名称搜索..." style="width: 240px;" />
				<button class="btn btn-primary" id="btn-search-deck">搜索</button>
				<button class="btn" id="btn-refresh-deck">刷新</button>

				<div style="margin-left: auto; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
					<label class="muted" style="font-size: 0.85rem;">半年周期:</label>
					<select id="deck-season-year"></select>
					<select id="deck-season-half">
						<option value="H1">上半年 (H1)</option>
						<option value="H2">下半年 (H2)</option>
					</select>
					<button class="btn" id="btn-query-season">切换半年</button>
				</div>
			</div>

			<!-- 候选列表容器 -->
			<div id="deck-candidates-container" class="candidates-container"></div>

			<!-- 状态通知信息框 -->
			<div id="page-status-message" class="status-box" style="margin-top: 0.75rem;"></div>
		</div>

		<!-- 卡组基本信息与使用占比卡片 -->
		<div class="card" id="card-deck-header" style="display: none;">
			<div class="deck-header-info">
				<div>
					<div class="deck-name" id="deck-name"></div>
					<div class="usage-stats" id="deck-usage-info"></div>
				</div>
			</div>
			<div class="notice-bar" id="deck-notice-bar">
				实时查询 (Asia/Shanghai)；排除其他，未知对手保留；具名卡组使用占比与每日使用率榜口径不同
			</div>
		</div>

		<!-- 对手对阵列表卡片 -->
		<div class="card" id="card-deck-matchups" style="display: none;">
			<div class="card-header">
				<div class="card-title">按对手分组对阵统计</div>
			</div>
			<div class="table-responsive">
				<table id="table-matchups">
					<thead>
						<tr>
							<th>对手卡组</th>
							<th>Match 综合胜率</th>
							<th>G1 先攻胜率</th>
							<th>G1 后攻胜率</th>
							<th>G1 座次未知场数</th>
						</tr>
					</thead>
					<tbody id="tbody-matchups"></tbody>
				</table>
			</div>
		</div>

		<!-- 专精玩家 Top10 榜单卡片 -->
		<div class="card" id="card-deck-top-players" style="display: none;">
			<div class="card-header">
				<div class="card-title">专精玩家胜率 Top10（至少 25 场有效 Match）</div>
			</div>
			<div class="table-responsive">
				<table id="table-top-players">
					<thead>
						<tr>
							<th style="width: 80px;">排名</th>
							<th>玩家昵称</th>
							<th>场次</th>
							<th>战绩 (胜/负)</th>
							<th>胜率</th>
						</tr>
					</thead>
					<tbody id="tbody-top-players"></tbody>
				</table>
			</div>
			<div id="top-players-empty" class="status-box status-empty" style="display: none; margin-top: 0.5rem;">
				当前暂无至少达到 25 场的达标玩家
			</div>
		</div>
		`
		}
	</main>

	${
		formatId === "1109"
			? `
	<script>
		(function() {
			var format = "${formatId}";
			var currentRequestId = 0;
			var state = {
				deckTypeCode: "",
				q: "",
				period: "",
			};

			function getBeijingHalfYear() {
				var now = new Date();
				var formatter = new Intl.DateTimeFormat("en-CA", {
					timeZone: "Asia/Shanghai",
					year: "numeric",
					month: "2-digit"
				});
				var parts = formatter.formatToParts(now);
				var year = "1970";
				var month = "01";
				for (var i = 0; i < parts.length; i++) {
					if (parts[i].type === "year") year = parts[i].value;
					if (parts[i].type === "month") month = parts[i].value;
				}
				var m = parseInt(month, 10);
				return year + (m <= 6 ? "H1" : "H2");
			}

			function initSeasonSelectors(defaultPeriod) {
				var yearSelect = document.getElementById("deck-season-year");
				var halfSelect = document.getElementById("deck-season-half");
				var curYear = parseInt(defaultPeriod.substring(0, 4), 10);
				var curHalf = defaultPeriod.substring(4, 6);

				yearSelect.innerHTML = "";
				for (var y = curYear; y >= 2024; y--) {
					var opt = document.createElement("option");
					opt.value = String(y);
					opt.textContent = y + " 年";
					if (y === curYear) opt.selected = true;
					yearSelect.appendChild(opt);
				}
				halfSelect.value = curHalf;
			}

			function showStatus(text, type) {
				var box = document.getElementById("page-status-message");
				if (!box) return;
				if (!text) {
					box.style.display = "none";
					box.textContent = "";
					box.className = "status-box";
					return;
				}
				box.textContent = text;
				box.className = "status-box status-" + (type || "info");
				box.style.display = "block";
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

			function formatRate(rate, wins, matches) {
				if (matches === 0 || rate === null || rate === undefined) {
					return '<span class="muted">数据不足</span>';
				}
				return (rate * 100).toFixed(2) + "% (" + wins + "/" + matches + ")";
			}

			function updateUrl() {
				var params = new URLSearchParams();
				if (state.deckTypeCode) {
					params.set("deckTypeCode", state.deckTypeCode);
				} else if (state.q) {
					params.set("q", state.q);
				}
				if (state.period) {
					params.set("period", state.period);
				}
				var newUrl = window.location.pathname + (params.toString() ? "?" + params.toString() : "");
				window.history.replaceState({}, "", newUrl);
			}

			function renderCandidates(candidates, selectedCode) {
				var container = document.getElementById("deck-candidates-container");
				if (!container) return;
				container.innerHTML = "";

				if (!candidates || candidates.length === 0) {
					return;
				}

				candidates.forEach(function(item) {
					var btn = document.createElement("button");
					btn.className = "candidate-btn" + (item.code === selectedCode ? " active" : "");
					btn.textContent = item.nameZh;
					btn.onclick = function() {
						state.deckTypeCode = item.code;
						state.q = "";
						document.getElementById("deck-search-input").value = "";
						fetchDeckDetail();
					};
					container.appendChild(btn);
				});
			}

			function renderDeckDetail(data) {
				var cardHeader = document.getElementById("card-deck-header");
				var cardMatchups = document.getElementById("card-deck-matchups");
				var cardTopPlayers = document.getElementById("card-deck-top-players");

				if (!data.selected) {
					cardHeader.style.display = "none";
					cardMatchups.style.display = "none";
					cardTopPlayers.style.display = "none";
					return;
				}

				cardHeader.style.display = "block";
				cardMatchups.style.display = "block";
				cardTopPlayers.style.display = "block";

				// 1. Deck header info
				document.getElementById("deck-name").textContent = data.selected.nameZh + " (" + data.selected.code + ")";
				var usageInfo = document.getElementById("deck-usage-info");
				if (data.usage) {
					var rateStr = data.usage.rate !== null ? (data.usage.rate * 100).toFixed(2) + "%" : "0.00%";
					usageInfo.innerHTML =
						'<span class="stat-tag">使用份数:</span><span class="stat-val">' + data.usage.count + ' 份</span>' +
						'<span class="stat-tag" style="margin-left: 1.5rem;">具名卡组使用占比:</span><span class="stat-val">' +
						rateStr + ' (' + data.usage.count + ' / ' + data.usage.denominator + ')</span>';
				}

				// 2. Matchup Table
				var tbodyMatchups = document.getElementById("tbody-matchups");
				tbodyMatchups.innerHTML = "";

				(data.matchups || []).forEach(function(m) {
					var tr = document.createElement("tr");
					var nameTd = document.createElement("td");
					if (m.opponentCode !== "unknown") {
						var link = document.createElement("a");
						link.className = "deck-link";
						link.textContent = m.opponentNameZh;
						link.href = "/leaderboards/" + format + "/deck-detail?deckTypeCode=" + encodeURIComponent(m.opponentCode) + (state.period ? "&period=" + encodeURIComponent(state.period) : "");
						link.target = "_blank";
						link.rel = "noopener noreferrer";
						nameTd.appendChild(link);
					} else {
						nameTd.textContent = m.opponentNameZh;
						nameTd.className = "muted";
					}
					tr.appendChild(nameTd);

					tr.innerHTML +=
						'<td>' + formatRate(m.matchWinRate, m.matchWins, m.matches) + '</td>' +
						'<td>' + formatRate(m.firstWinRate, m.firstWins, m.firstMatches) + '</td>' +
						'<td>' + formatRate(m.secondWinRate, m.secondWins, m.secondMatches) + '</td>' +
						'<td>' + (m.unknownSeatMatches > 0 ? m.unknownSeatMatches + ' 场 (' + m.unknownSeatWins + '胜)' : '<span class="muted">0</span>') + '</td>';

					tbodyMatchups.appendChild(tr);
				});

				// Total Row
				if (data.total) {
					var totalTr = document.createElement("tr");
					totalTr.className = "total-row";
					totalTr.innerHTML =
						'<td>' + escapeHtml(data.total.opponentNameZh) + '</td>' +
						'<td>' + formatRate(data.total.matchWinRate, data.total.matchWins, data.total.matches) + '</td>' +
						'<td>' + formatRate(data.total.firstWinRate, data.total.firstWins, data.total.firstMatches) + '</td>' +
						'<td>' + formatRate(data.total.secondWinRate, data.total.secondWins, data.total.secondMatches) + '</td>' +
						'<td>' + (data.total.unknownSeatMatches > 0 ? data.total.unknownSeatMatches + ' 场 (' + data.total.unknownSeatWins + '胜)' : '<span class="muted">0</span>') + '</td>';
					tbodyMatchups.appendChild(totalTr);
				}

				// 3. Top Players
				var tbodyPlayers = document.getElementById("tbody-top-players");
				var emptyBox = document.getElementById("top-players-empty");
				tbodyPlayers.innerHTML = "";

				if (!data.topPlayers || data.topPlayers.length === 0) {
					emptyBox.style.display = "block";
				} else {
					emptyBox.style.display = "none";
					data.topPlayers.forEach(function(p) {
						var rankClass = p.rank === 1 ? "rank-1" : p.rank === 2 ? "rank-2" : p.rank === 3 ? "rank-3" : "";
						var tr = document.createElement("tr");
						tr.innerHTML =
							'<td class="' + rankClass + '">' + p.rank + '</td>' +
							'<td><a class="player-link" target="_blank" href="/leaderboards/${formatId}/player?player=' +
								encodeURIComponent(p.username) + '&scope=season&season=' + encodeURIComponent(data.period) + '">' +
								escapeHtml(p.username) + '</a></td>' +
							'<td>' + p.matches + '</td>' +
							'<td>' + p.wins + ' 胜 / ' + p.losses + ' 负</td>' +
							'<td>' + (p.winRate * 100).toFixed(2) + '%</td>';
						tbodyPlayers.appendChild(tr);
					});
				}
			}

			function fetchDeckDetail() {
				var reqId = ++currentRequestId;
				showStatus("正在加载数据...", "info");

				var params = new URLSearchParams();
				if (state.deckTypeCode) params.set("deckTypeCode", state.deckTypeCode);
				else if (state.q) params.set("q", state.q);
				if (state.period) params.set("period", state.period);

				var url = "/api/ladder/" + format + "/deck-detail" + (params.toString() ? "?" + params.toString() : "");

				fetch(url)
					.then(function(res) {
						return res.json().then(function(json) {
							return { ok: res.ok, status: res.status, json: json };
						});
					})
					.then(function(resp) {
						if (reqId !== currentRequestId) return;

						if (!resp.ok || !resp.json.success) {
							var err = (resp.json && resp.json.error) || "查询卡组详情失败";
							showStatus("查询失败: " + err, "error");
							renderDeckDetail({ selected: null });
							return;
						}

						var data = resp.json.data;
						showStatus("", "");

						if (data.notFound) {
							showStatus("未找到与 \\"" + escapeHtml(state.q) + "\\" 匹配的卡组分类", "empty");
						} else if (!data.selected && data.candidates && data.candidates.length > 1) {
							showStatus("搜索到多个匹配卡组，请点击下方候选进行选择", "info");
						}

						if (data.selected) {
							state.deckTypeCode = data.selected.code;
							state.q = "";
						}

						updateUrl();
						renderCandidates(data.candidates || data.catalog, data.selected ? data.selected.code : "");
						renderDeckDetail(data);
					})
					.catch(function(err) {
						if (reqId !== currentRequestId) return;
						showStatus("网络请求异常，请点击刷新重试: " + err.message, "error");
						renderDeckDetail({ selected: null });
					});
			}

			// Event listeners
			document.getElementById("btn-search-deck").onclick = function() {
				var queryVal = document.getElementById("deck-search-input").value.trim();
				state.deckTypeCode = "";
				state.q = queryVal;
				fetchDeckDetail();
			};

			document.getElementById("deck-search-input").onkeydown = function(e) {
				if (e.key === "Enter") {
					document.getElementById("btn-search-deck").click();
				}
			};

			document.getElementById("btn-refresh-deck").onclick = function() {
				fetchDeckDetail();
			};

			document.getElementById("btn-query-season").onclick = function() {
				var y = document.getElementById("deck-season-year").value;
				var h = document.getElementById("deck-season-half").value;
				state.period = y + h;
				fetchDeckDetail();
			};

			// Initialization from URL params
			var urlParams = new URLSearchParams(window.location.search);
			state.deckTypeCode = urlParams.get("deckTypeCode") || "";
			state.q = urlParams.get("q") || "";
			state.period = urlParams.get("period") || getBeijingHalfYear();

			if (state.q) {
				document.getElementById("deck-search-input").value = state.q;
			}

			initSeasonSelectors(state.period);
			fetchDeckDetail();
		})();
	</script>
	`
			: ""
	}
</body>
</html>`;
}

/**
 * 卡组详情页面控制器
 * 路径：GET /leaderboards/:format/deck-detail
 */
export class DeckDetailPageController {
	public run(req: Request, res: Response): void {
		if (!config.ranking.enabled) {
			res.status(503).json({
				success: false,
				error: "Deck detail page is currently unavailable (ranking disabled)",
			});
			return;
		}

		const formatParam = req.params.format;
		const format = Array.isArray(formatParam) ? formatParam[0] : (formatParam ?? "");

		if (!getNostalgiaFormat(format)) {
			res.status(404).json({
				success: false,
				error: `Unknown format: ${format}`,
			});
			return;
		}

		res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
		res.setHeader("Pragma", "no-cache");
		res.setHeader("Expires", "0");

		res.type("html").send(renderDeckDetailPage(format));
	}
}
