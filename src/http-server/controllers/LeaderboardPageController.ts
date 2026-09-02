import { Request, Response } from "express";
import { config } from "src/config";
import { getNostalgiaFormat } from "@ygopro/room/domain/NostalgiaFormat";

export function renderLeaderboardPage(formatId: string): string {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Nostalgia Duel Server · ${formatId} 决斗专区</title>
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
			max-width: 1200px;
			width: 100%;
			margin: 0 auto;
		}
		.tab-content {
			display: none;
		}
		.tab-content.active {
			display: block;
		}
		.toolbar {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 1rem;
			flex-wrap: wrap;
			gap: 0.75rem;
		}
		.controls-group {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			flex-wrap: wrap;
		}
		input, select, button {
			font: inherit;
			color: var(--text-bright);
		}
		input[type="text"], input[type="month"] {
			background: var(--panel);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: 0.4rem 0.75rem;
			font-size: 0.85rem;
			outline: none;
		}
		input[type="text"]:focus, input[type="month"]:focus {
			border-color: var(--primary);
		}
		.btn {
			background: var(--panel-2);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: 0.4rem 0.85rem;
			font-size: 0.85rem;
			cursor: pointer;
			color: var(--text-bright);
			transition: all 0.12s ease;
			display: inline-flex;
			align-items: center;
			gap: 0.35rem;
			text-decoration: none;
		}
		.btn:hover:not(:disabled) {
			background: var(--border);
		}
		.btn:disabled {
			opacity: 0.4;
			cursor: not-allowed;
		}
		.btn-primary {
			background: var(--primary);
			border-color: var(--primary);
			color: #fff;
		}
		.btn-primary:hover:not(:disabled) {
			background: var(--primary-hover);
			border-color: var(--primary-hover);
		}
		.btn-copy {
			padding: 0.2rem 0.5rem;
			font-size: 0.75rem;
		}
		.stats-bar {
			background: var(--panel);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: 0.6rem 1rem;
			font-size: 0.85rem;
			color: var(--muted);
			margin-bottom: 1rem;
			display: flex;
			gap: 1.5rem;
			flex-wrap: wrap;
		}
		.stats-bar strong {
			color: var(--text-bright);
		}
		.table-container {
			background: var(--panel);
			border: 1px solid var(--border);
			border-radius: 8px;
			overflow-x: auto;
			margin-bottom: 1rem;
		}
		table {
			width: 100%;
			border-collapse: collapse;
			text-align: left;
			font-size: 0.875rem;
			white-space: nowrap;
		}
		th, td {
			padding: 0.75rem 1rem;
			border-bottom: 1px solid var(--border);
		}
		th {
			background: var(--panel-2);
			color: var(--muted);
			font-weight: 600;
			font-size: 0.8rem;
			text-transform: uppercase;
			letter-spacing: 0.05em;
		}
		tr:last-child td {
			border-bottom: none;
		}
		tr:hover td {
			background: rgba(255, 255, 255, 0.02);
		}
		.state-badge {
			display: inline-block;
			padding: 0.15rem 0.5rem;
			border-radius: 12px;
			font-size: 0.75rem;
			font-weight: 500;
		}
		.state-waiting { background: rgba(56, 139, 253, 0.15); color: #58a6ff; }
		.state-dueling { background: rgba(63, 185, 80, 0.15); color: #3fb950; }
		.tag-ranked { background: rgba(210, 153, 34, 0.15); color: var(--gold-soft); border: 1px solid rgba(210, 153, 34, 0.3); }
		.tag-normal { background: rgba(139, 148, 158, 0.15); color: var(--text); }
		
		.rank-1 { color: var(--rank-1); font-weight: bold; }
		.rank-2 { color: var(--rank-2); font-weight: bold; }
		.rank-3 { color: var(--rank-3); font-weight: bold; }
		
		.info-box {
			padding: 3rem 1.5rem;
			text-align: center;
			color: var(--muted);
			font-size: 0.95rem;
		}
		.info-box.error {
			color: var(--danger);
		}
		.pager {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 0.5rem;
			flex-wrap: wrap;
			margin-top: 0.5rem;
		}
		.pager-info {
			font-size: 0.85rem;
			color: var(--muted);
		}
		.toast {
			position: fixed;
			bottom: 1.5rem;
			right: 1.5rem;
			background: var(--panel-2);
			border: 1px solid var(--border);
			padding: 0.6rem 1.2rem;
			border-radius: 6px;
			box-shadow: 0 4px 12px rgba(0,0,0,0.5);
			font-size: 0.85rem;
			color: var(--text-bright);
			opacity: 0;
			transform: translateY(10px);
			transition: all 0.2s ease;
			pointer-events: none;
			z-index: 1000;
		}
		.toast.show {
			opacity: 1;
			transform: translateY(0);
		}
		@media (max-width: 768px) {
			header { flex-direction: column; align-items: stretch; }
			.tabs { justify-content: stretch; }
			.tab-btn { flex: 1; text-align: center; }
			.toolbar { flex-direction: column; align-items: stretch; }
			.controls-group { width: 100%; justify-content: space-between; }
		}
		@media (max-width: 480px) {
			main { padding: 1rem 0.5rem; }
			.stats-bar { flex-direction: column; gap: 0.35rem; }
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
			<button class="tab-btn active" data-tab="rooms">房间列表</button>
			<button class="tab-btn" data-tab="replays">录像下载</button>
			<button class="tab-btn" data-tab="ladder">天梯排行</button>
		</nav>
	</header>

	<main>
		<!-- 房间列表 Tab -->
		<section id="tab-rooms" class="tab-content active">
			<div class="toolbar">
				<div class="controls-group">
					<button id="btn-refresh-rooms" class="btn">刷新房间</button>
				</div>
			</div>
			<div id="rooms-stats" class="stats-bar" style="display: none;">
				<span>房间总数: <strong id="stat-total">0</strong></span>
				<span>对局中: <strong id="stat-dueling">0</strong></span>
				<span>在线玩家: <strong id="stat-players">0</strong></span>
				<span>更新时间: <strong id="stat-updated">-</strong></span>
			</div>
			<div class="table-container">
				<table id="table-rooms">
					<thead>
						<tr>
							<th>房名 / 观战号</th>
							<th>类型</th>
							<th>模式</th>
							<th>玩家</th>
							<th>状态</th>
							<th>操作</th>
						</tr>
					</thead>
					<tbody id="rooms-tbody">
						<tr><td colspan="6" class="info-box">正在加载房间列表...</td></tr>
					</tbody>
				</table>
			</div>
		</section>

		<!-- 录像下载 Tab -->
		<section id="tab-replays" class="tab-content">
			<div class="toolbar">
				<div class="controls-group">
					<input type="text" id="replays-search-input" placeholder="按玩家昵称搜索录像" />
					<button id="btn-search-replays" class="btn btn-primary">搜索</button>
					<button id="btn-clear-replays" class="btn">清空</button>
				</div>
				<div class="controls-group">
					<button id="btn-refresh-replays" class="btn">刷新本页</button>
				</div>
			</div>
			<div class="table-container">
				<table id="table-replays">
					<thead>
						<tr>
							<th>结束时间 (北京时间)</th>
							<th>对战双方</th>
							<th>大小</th>
							<th>操作</th>
						</tr>
					</thead>
					<tbody id="replays-tbody">
						<tr><td colspan="4" class="info-box">正在加载录像列表...</td></tr>
					</tbody>
				</table>
			</div>
			<div class="pager" id="replays-pager" style="display: none;">
				<div class="pager-info" id="replays-pager-info">第 1 / 1 页，共 0 条</div>
				<div class="controls-group">
					<button id="btn-prev-replays" class="btn" disabled>上一页</button>
					<button id="btn-next-replays" class="btn" disabled>下一页</button>
				</div>
			</div>
		</section>

		<!-- 天梯排行 Tab -->
		<section id="tab-ladder" class="tab-content">
			<div class="toolbar">
				<div class="controls-group">
					<button id="btn-scope-season" class="btn btn-primary">月榜</button>
					<button id="btn-scope-overall" class="btn">总榜</button>
					<input type="month" id="ladder-season-input" />
					<button id="btn-query-month" class="btn">查询月份</button>
				</div>
				<div class="controls-group">
					<input type="text" id="ladder-search-input" placeholder="搜索玩家昵称" />
					<button id="btn-search-ladder" class="btn btn-primary">搜索</button>
					<button id="btn-clear-ladder" class="btn">清空</button>
					<button id="btn-refresh-ladder" class="btn">刷新</button>
				</div>
			</div>
			<div class="table-container">
				<table id="table-ladder">
					<thead>
						<tr>
							<th>排名</th>
							<th>玩家</th>
							<th>总积分</th>
							<th>总场次</th>
							<th>胜场</th>
							<th>败场</th>
							<th>胜率</th>
						</tr>
					</thead>
					<tbody id="ladder-tbody">
						<tr><td colspan="7" class="info-box">正在加载天梯排行榜...</td></tr>
					</tbody>
				</table>
			</div>
			<div class="pager" id="ladder-pager" style="display: none;">
				<div class="pager-info" id="ladder-pager-info">第 1 / 1 页，共 0 条</div>
				<div class="controls-group">
					<button id="btn-prev-ladder" class="btn" disabled>上一页</button>
					<button id="btn-next-ladder" class="btn" disabled>下一页</button>
				</div>
			</div>
		</section>
	</main>

	<div id="toast" class="toast"></div>

	<script>
		(function() {
			var FORMAT = "${formatId}";
			var toastTimer = null;

			function showToast(msg) {
				var t = document.getElementById("toast");
				t.textContent = msg;
				t.classList.add("show");
				if (toastTimer) clearTimeout(toastTimer);
				toastTimer = setTimeout(function() {
					t.classList.remove("show");
				}, 2000);
			}

			function copyText(text) {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(text).then(function() {
						showToast("已复制: " + text);
					}, function() {
						fallbackCopy(text);
					});
				} else {
					fallbackCopy(text);
				}
			}

			function fallbackCopy(text) {
				var ta = document.createElement("textarea");
				ta.value = text;
				ta.style.position = "fixed";
				ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.select();
				try {
					var successful = document.execCommand("copy");
					if (successful) {
						showToast("已复制: " + text);
					} else {
						showToast("复制失败，请手动输入");
					}
				} catch (e) {
					showToast("复制失败，请手动输入");
				}
				document.body.removeChild(ta);
			}

			function getBeijingMonth() {
				try {
					var parts = new Intl.DateTimeFormat("en-US", {
						timeZone: "Asia/Shanghai",
						year: "numeric",
						month: "2-digit"
					}).formatToParts(new Date());
					var y = "", m = "";
					for (var i = 0; i < parts.length; i++) {
						if (parts[i].type === "year") y = parts[i].value;
						if (parts[i].type === "month") m = parts[i].value;
					}
					if (m && m.length < 2) m = "0" + m;
					if (y && m && /^\d{4}$/.test(y) && /^\d{2}$/.test(m)) return y + "-" + m;
				} catch (e) {}
				var d = new Date();
				var utc = d.getTime() + (d.getTimezoneOffset() * 60000);
				var bj = new Date(utc + (3600000 * 8));
				var year = bj.getFullYear();
				var monthNum = bj.getMonth() + 1;
				var month = monthNum < 10 ? ("0" + monthNum) : String(monthNum);
				return year + "-" + month;
			}

			function parseSeasonInput(raw) {
				if (!raw) return null;
				var str = String(raw).trim();
				var m = str.match(/^(\d{4})[^\d]?(\d{1,2})[^\d]?$/) ||
				        str.match(/^(\d{4})[^\d]+(\d{1,2})/);
				if (m) {
					var year = m[1];
					var month = parseInt(m[2], 10);
					if (month >= 1 && month <= 12) {
						return year + "-" + (month < 10 ? "0" + month : String(month));
					}
				}
				var m2 = str.match(/^(\d{2})[^\d]+(\d{1,2})/);
				if (m2) {
					var yearNum = parseInt(m2[1], 10);
					var y2 = yearNum < 50 ? String(2000 + yearNum) : String(1900 + yearNum);
					var month2 = parseInt(m2[2], 10);
					if (month2 >= 1 && month2 <= 12) {
						return y2 + "-" + (month2 < 10 ? "0" + month2 : String(month2));
					}
				}
				var m3 = str.match(/^(\d{4})(\d{2})$/);
				if (m3) {
					var y3 = m3[1];
					var month3 = parseInt(m3[2], 10);
					if (month3 >= 1 && month3 <= 12) {
						return y3 + "-" + (month3 < 10 ? "0" + month3 : String(month3));
					}
				}
				return null;
			}

			function formatBytes(bytes) {
				if (!bytes || bytes <= 0) return "0 B";
				var k = 1024;
				var sizes = ["B", "KB", "MB"];
				var i = Math.floor(Math.log(bytes) / Math.log(k));
				return (bytes / Math.pow(k, i)).toFixed(1) + " " + sizes[i];
			}

			// --- Tab Switching ---
			var tabButtons = document.querySelectorAll(".tab-btn");
			var tabContents = document.querySelectorAll(".tab-content");

			tabButtons.forEach(function(btn) {
				btn.addEventListener("click", function() {
					var tabId = btn.getAttribute("data-tab");
					tabButtons.forEach(function(b) { b.classList.remove("active"); });
					tabContents.forEach(function(c) { c.classList.remove("active"); });
					btn.classList.add("active");
					var target = document.getElementById("tab-" + tabId);
					if (target) target.classList.add("active");
					if (tabId === "rooms" && !roomsState.loaded) loadRooms();
					if (tabId === "replays" && !replaysState.loaded) loadReplays();
					if (tabId === "ladder" && !ladderState.loaded) loadLadder();
				});
			});

			// --- Tab 1: 房间列表 ---
			var roomsState = {
				requestId: 0,
				loaded: false
			};

			function loadRooms() {
				var reqId = ++roomsState.requestId;
				var tbody = document.getElementById("rooms-tbody");
				tbody.innerHTML = "";
				var loadingRow = document.createElement("tr");
				var loadingTd = document.createElement("td");
				loadingTd.colSpan = 6;
				loadingTd.className = "info-box";
				loadingTd.textContent = "正在加载房间列表...";
				loadingRow.appendChild(loadingTd);
				tbody.appendChild(loadingRow);

				fetch("/api/getrooms")
					.then(function(res) {
						if (!res.ok) throw new Error("加载房间失败: " + res.status);
						return res.json();
					})
					.then(function(data) {
						if (reqId !== roomsState.requestId) return;
						roomsState.loaded = true;
						var rooms = (data.rooms || []).filter(function(r) {
							return String(r.formatId) === FORMAT;
						});

						renderRooms(rooms);
					})
					.catch(function(err) {
						if (reqId !== roomsState.requestId) return;
						tbody.innerHTML = "";
						var errRow = document.createElement("tr");
						var errTd = document.createElement("td");
						errTd.colSpan = 6;
						errTd.className = "info-box error";
						errTd.textContent = "加载房间列表失败，请重试";
						errRow.appendChild(errTd);
						tbody.appendChild(errRow);
						document.getElementById("rooms-stats").style.display = "none";
					});
			}

			function renderRooms(rooms) {
				var tbody = document.getElementById("rooms-tbody");
				tbody.innerHTML = "";
				var statsBar = document.getElementById("rooms-stats");

				var totalRooms = rooms.length;
				var duelingCount = 0;
				var totalPlayers = 0;

				for (var i = 0; i < rooms.length; i++) {
					var r = rooms[i];
					var isDueling = r.istart === "start";
					if (isDueling) duelingCount++;
					var users = r.users || [];
					totalPlayers += users.length;
				}

				document.getElementById("stat-total").textContent = String(totalRooms);
				document.getElementById("stat-dueling").textContent = String(duelingCount);
				document.getElementById("stat-players").textContent = String(totalPlayers);
				var now = new Date();
				var timeStr = String(now.getHours()).padStart(2, "0") + ":" +
					String(now.getMinutes()).padStart(2, "0") + ":" +
					String(now.getSeconds()).padStart(2, "0");
				document.getElementById("stat-updated").textContent = timeStr;
				statsBar.style.display = "flex";

				if (rooms.length === 0) {
					var emptyRow = document.createElement("tr");
					var emptyTd = document.createElement("td");
					emptyTd.colSpan = 6;
					emptyTd.className = "info-box";
					emptyTd.textContent = "当前格式暂无活动房间";
					emptyRow.appendChild(emptyTd);
					tbody.appendChild(emptyRow);
					return;
				}

				rooms.forEach(function(r) {
					var isRanked = (r.roomnotes && r.roomnotes.indexOf("(Mercury-Ranked)") !== -1) ||
						(r.roomname && r.roomname.indexOf("#TT") !== -1);
					var isDueling = r.istart === "start";

					var row = document.createElement("tr");

					// Col 1: 房名 / 观战号
					var tdName = document.createElement("td");
					if (isRanked) {
						tdName.textContent = "观战号: " + (r.roomid || "-");
					} else {
						tdName.textContent = r.roomname || "-";
					}
					row.appendChild(tdName);

					// Col 2: 类型
					var tdType = document.createElement("td");
					var badgeType = document.createElement("span");
					badgeType.className = "state-badge " + (isRanked ? "tag-ranked" : "tag-normal");
					badgeType.textContent = isRanked ? "排位" : "普通";
					tdType.appendChild(badgeType);
					row.appendChild(tdType);

					// Col 3: 模式
					var tdMode = document.createElement("td");
					tdMode.textContent = r.roommode === "2" || r.roommode === 2 ? "MATCH" : (r.roommode || "MATCH");
					row.appendChild(tdMode);

					// Col 4: 玩家
					var tdPlayers = document.createElement("td");
					if (isRanked && !isDueling) {
						tdPlayers.textContent = "等待匹配中";
					} else {
						var userNames = (r.users || []).map(function(u) { return u.name; }).join(" vs ");
						tdPlayers.textContent = userNames || "无玩家";
					}
					row.appendChild(tdPlayers);

					// Col 5: 状态
					var tdStatus = document.createElement("td");
					var badgeStatus = document.createElement("span");
					badgeStatus.className = "state-badge " + (isDueling ? "state-dueling" : "state-waiting");
					badgeStatus.textContent = isDueling ? "对局中" : "等待中";
					tdStatus.appendChild(badgeStatus);
					row.appendChild(tdStatus);

					// Col 6: 操作
					var tdAction = document.createElement("td");
					var copyBtn = document.createElement("button");
					copyBtn.className = "btn btn-copy";
					if (isRanked) {
						copyBtn.textContent = "复制观战号";
						var specTarget = FORMAT + "#TT" + r.roomid;
						copyBtn.addEventListener("click", function() { copyText(specTarget); });
					} else {
						copyBtn.textContent = "复制房间名";
						var joinTarget = r.roomname || (FORMAT + "#" + r.roomid);
						copyBtn.addEventListener("click", function() { copyText(joinTarget); });
					}
					tdAction.appendChild(copyBtn);
					row.appendChild(tdAction);

					tbody.appendChild(row);
				});
			}

			document.getElementById("btn-refresh-rooms").addEventListener("click", loadRooms);

			// --- Tab 2: 录像下载 ---
			var replaysState = {
				requestId: 0,
				loaded: false,
				page: 1,
				pageSize: 20,
				search: "",
				total: 0
			};

			function loadReplays() {
				var reqId = ++replaysState.requestId;
				var tbody = document.getElementById("replays-tbody");
				tbody.innerHTML = "";
				var loadingRow = document.createElement("tr");
				var loadingTd = document.createElement("td");
				loadingTd.colSpan = 4;
				loadingTd.className = "info-box";
				loadingTd.textContent = "正在加载录像列表...";
				loadingRow.appendChild(loadingTd);
				tbody.appendChild(loadingRow);

				var url = "/api/replays/" + FORMAT + "?page=" + replaysState.page + "&pageSize=" + replaysState.pageSize;
				if (replaysState.search) {
					url += "&search=" + encodeURIComponent(replaysState.search);
				}

				fetch(url)
					.then(function(res) {
						if (!res.ok) throw new Error("加载录像失败: " + res.status);
						return res.json();
					})
					.then(function(data) {
						if (reqId !== replaysState.requestId) return;
						replaysState.loaded = true;
						replaysState.total = data.total || 0;
						renderReplays(data.replays || []);
					})
					.catch(function(err) {
						if (reqId !== replaysState.requestId) return;
						tbody.innerHTML = "";
						var errRow = document.createElement("tr");
						var errTd = document.createElement("td");
						errTd.colSpan = 4;
						errTd.className = "info-box error";
						errTd.textContent = "加载录像失败，请重试";
						errRow.appendChild(errTd);
						tbody.appendChild(errRow);
						document.getElementById("replays-pager").style.display = "none";
					});
			}

			function renderReplays(replays) {
				var tbody = document.getElementById("replays-tbody");
				tbody.innerHTML = "";
				var pager = document.getElementById("replays-pager");

				if (replays.length === 0) {
					var emptyRow = document.createElement("tr");
					var emptyTd = document.createElement("td");
					emptyTd.colSpan = 4;
					emptyTd.className = "info-box";
					emptyTd.textContent = replaysState.search ? "没有找到符合条件的录像" : "暂无录像记录";
					emptyRow.appendChild(emptyTd);
					tbody.appendChild(emptyRow);
					pager.style.display = "none";
					return;
				}

				replays.forEach(function(rep) {
					var row = document.createElement("tr");

					// Col 1: 结束时间
					var tdTime = document.createElement("td");
					tdTime.textContent = rep.endedAt || "-";
					row.appendChild(tdTime);

					// Col 2: 对战双方
					var tdPlayers = document.createElement("td");
					var p1 = rep.player1Name || "未知";
					var p2 = rep.player2Name || "未知";
					tdPlayers.textContent = p1 + " VS " + p2;
					row.appendChild(tdPlayers);

					// Col 3: 大小
					var tdSize = document.createElement("td");
					tdSize.textContent = formatBytes(rep.size);
					row.appendChild(tdSize);

					// Col 4: 操作
					var tdAction = document.createElement("td");
					var downloadLink = document.createElement("a");
					downloadLink.className = "btn btn-copy btn-primary";
					downloadLink.href = "/api/replays/" + FORMAT + "/" + encodeURIComponent(rep.replayId);
					downloadLink.textContent = "下载 .yrp";
					downloadLink.setAttribute("download", "");
					tdAction.appendChild(downloadLink);
					row.appendChild(tdAction);

					tbody.appendChild(row);
				});

				// Update pager
				var totalPages = Math.max(1, Math.ceil(replaysState.total / replaysState.pageSize));
				document.getElementById("replays-pager-info").textContent =
					"第 " + replaysState.page + " / " + totalPages + " 页，共 " + replaysState.total + " 条";
				document.getElementById("btn-prev-replays").disabled = replaysState.page <= 1;
				document.getElementById("btn-next-replays").disabled = replaysState.page >= totalPages;
				pager.style.display = "flex";
			}

			document.getElementById("btn-search-replays").addEventListener("click", function() {
				replaysState.search = document.getElementById("replays-search-input").value.trim();
				replaysState.page = 1;
				loadReplays();
			});
			document.getElementById("replays-search-input").addEventListener("keydown", function(e) {
				if (e.key === "Enter") {
					replaysState.search = document.getElementById("replays-search-input").value.trim();
					replaysState.page = 1;
					loadReplays();
				}
			});
			document.getElementById("btn-clear-replays").addEventListener("click", function() {
				document.getElementById("replays-search-input").value = "";
				replaysState.search = "";
				replaysState.page = 1;
				loadReplays();
			});
			document.getElementById("btn-refresh-replays").addEventListener("click", loadReplays);
			document.getElementById("btn-prev-replays").addEventListener("click", function() {
				if (replaysState.page > 1) {
					replaysState.page--;
					loadReplays();
				}
			});
			document.getElementById("btn-next-replays").addEventListener("click", function() {
				var totalPages = Math.ceil(replaysState.total / replaysState.pageSize);
				if (replaysState.page < totalPages) {
					replaysState.page++;
					loadReplays();
				}
			});

			// --- Tab 3: 天梯排行 ---
			var ladderState = {
				requestId: 0,
				loaded: false,
				scope: "season",
				season: getBeijingMonth(),
				search: "",
				page: 1,
				pageSize: 50,
				total: 0
			};

			document.getElementById("ladder-season-input").value = ladderState.season;

			function loadLadder() {
				var reqId = ++ladderState.requestId;
				var tbody = document.getElementById("ladder-tbody");
				tbody.innerHTML = "";
				var loadingRow = document.createElement("tr");
				var loadingTd = document.createElement("td");
				loadingTd.colSpan = 7;
				loadingTd.className = "info-box";
				loadingTd.textContent = "正在加载天梯排行榜...";
				loadingRow.appendChild(loadingTd);
				tbody.appendChild(loadingRow);

				if (ladderState.scope === "season") {
					var inputElem = document.getElementById("ladder-season-input");
					var inputVal = inputElem ? inputElem.value.trim() : "";
					var parsedInput = parseSeasonInput(inputVal);
					if (parsedInput) {
						ladderState.season = parsedInput;
					} else if (!ladderState.season || !parseSeasonInput(ladderState.season)) {
						ladderState.season = getBeijingMonth();
					}
					if (inputElem) {
						inputElem.value = ladderState.season;
					}
				}

				var url = "/api/leaderboards/" + FORMAT + "?scope=" + ladderState.scope +
					"&page=" + ladderState.page + "&pageSize=" + ladderState.pageSize;
				if (ladderState.scope === "season" && ladderState.season) {
					url += "&season=" + encodeURIComponent(ladderState.season);
				}
				if (ladderState.search) {
					url += "&search=" + encodeURIComponent(ladderState.search);
				}

				fetch(url)
					.then(function(res) {
						if (!res.ok) {
							return res.json().then(function(d) {
								throw new Error(d && d.error ? d.error : ("HTTP " + res.status));
							}).catch(function(e) {
								if (e && e.message && e.message.indexOf("HTTP") === -1) {
									throw e;
								}
								throw new Error("HTTP " + res.status);
							});
						}
						return res.json();
					})
					.then(function(data) {
						if (reqId !== ladderState.requestId) return;
						ladderState.loaded = true;
						ladderState.total = data.total != null ? data.total : (data.leaderboard || []).length;
						renderLadder(data.leaderboard || []);
					})
					.catch(function(err) {
						if (reqId !== ladderState.requestId) return;
						console.error("加载排行榜失败:", err);
						tbody.innerHTML = "";
						var errRow = document.createElement("tr");
						var errTd = document.createElement("td");
						errTd.colSpan = 7;
						errTd.className = "info-box error";
						var msg = (err && err.message) ? ("加载排行榜失败 (" + err.message + ")，请重试") : "加载排行榜失败，请重试";
						errTd.textContent = msg;
						errRow.appendChild(errTd);
						tbody.appendChild(errRow);
						document.getElementById("ladder-pager").style.display = "none";
					});
			}

			function renderLadder(entries) {
				var tbody = document.getElementById("ladder-tbody");
				tbody.innerHTML = "";
				var pager = document.getElementById("ladder-pager");

				if (entries.length === 0) {
					var emptyRow = document.createElement("tr");
					var emptyTd = document.createElement("td");
					emptyTd.colSpan = 7;
					emptyTd.className = "info-box";
					emptyTd.textContent = ladderState.search ? "没有找到符合条件的玩家" : "该格式与当前视图暂无排位记录";
					emptyRow.appendChild(emptyTd);
					tbody.appendChild(emptyRow);
					pager.style.display = "none";
					return;
				}

				var totalCount = ladderState.total;

				entries.forEach(function(entry) {
					var row = document.createElement("tr");

					// Col 1: 排名
					var tdRank = document.createElement("td");
					tdRank.textContent = String(entry.rank);
					if (entry.rank === 1) tdRank.className = "rank-1";
					else if (entry.rank === 2) tdRank.className = "rank-2";
					else if (entry.rank === 3) tdRank.className = "rank-3";
					row.appendChild(tdRank);

					// Col 2: 玩家 (后 30% 且无搜索时打码)
					var tdPlayer = document.createElement("td");
					var isMasked = !ladderState.search && totalCount > 0 && (entry.rank / totalCount >= 0.7);
					tdPlayer.textContent = isMasked ? "******" : entry.username;
					row.appendChild(tdPlayer);

					// Col 3: 总积分
					var tdPoints = document.createElement("td");
					tdPoints.textContent = String(entry.points);
					row.appendChild(tdPoints);

					// Col 4: 总场次 (胜+败)
					var totalMatches = (entry.wins || 0) + (entry.losses || 0);
					var tdTotal = document.createElement("td");
					tdTotal.textContent = String(totalMatches);
					row.appendChild(tdTotal);

					// Col 5: 胜场
					var tdWins = document.createElement("td");
					tdWins.textContent = String(entry.wins || 0);
					row.appendChild(tdWins);

					// Col 6: 败场
					var tdLosses = document.createElement("td");
					tdLosses.textContent = String(entry.losses || 0);
					row.appendChild(tdLosses);

					// Col 7: 胜率
					var tdWinRate = document.createElement("td");
					var winRatePct = entry.winRate != null ? (entry.winRate * 100).toFixed(1) + "%" : "0.0%";
					tdWinRate.textContent = winRatePct;
					row.appendChild(tdWinRate);

					tbody.appendChild(row);
				});

				// Update pager
				var totalPages = Math.max(1, Math.ceil(ladderState.total / ladderState.pageSize));
				document.getElementById("ladder-pager-info").textContent =
					"第 " + ladderState.page + " / " + totalPages + " 页，共 " + ladderState.total + " 条";
				document.getElementById("btn-prev-ladder").disabled = ladderState.page <= 1;
				document.getElementById("btn-next-ladder").disabled = ladderState.page >= totalPages;
				pager.style.display = "flex";
			}

			document.getElementById("btn-scope-season").addEventListener("click", function() {
				ladderState.scope = "season";
				document.getElementById("btn-scope-season").classList.add("btn-primary");
				document.getElementById("btn-scope-overall").classList.remove("btn-primary");
				document.getElementById("ladder-season-input").style.display = "inline-block";
				document.getElementById("btn-query-month").style.display = "inline-block";
				var inputElem = document.getElementById("ladder-season-input");
				var val = inputElem ? inputElem.value.trim() : "";
				var parsed = parseSeasonInput(val);
				if (parsed) {
					ladderState.season = parsed;
					if (inputElem) inputElem.value = ladderState.season;
				} else if (!ladderState.season) {
					ladderState.season = getBeijingMonth();
					if (inputElem) inputElem.value = ladderState.season;
				}
				ladderState.page = 1;
				loadLadder();
			});

			document.getElementById("btn-scope-overall").addEventListener("click", function() {
				ladderState.scope = "overall";
				document.getElementById("btn-scope-overall").classList.add("btn-primary");
				document.getElementById("btn-scope-season").classList.remove("btn-primary");
				document.getElementById("ladder-season-input").style.display = "none";
				document.getElementById("btn-query-month").style.display = "none";
				ladderState.page = 1;
				loadLadder();
			});

			document.getElementById("btn-query-month").addEventListener("click", function() {
				var inputElem = document.getElementById("ladder-season-input");
				var val = inputElem ? inputElem.value.trim() : "";
				var parsed = parseSeasonInput(val) || parseSeasonInput(ladderState.season) || getBeijingMonth();
				ladderState.season = parsed;
				if (inputElem) inputElem.value = ladderState.season;
				ladderState.page = 1;
				loadLadder();
			});

			document.getElementById("ladder-season-input").addEventListener("input", function() {
				var val = this.value.trim();
				var parsed = parseSeasonInput(val);
				if (parsed) {
					ladderState.season = parsed;
				}
			});

			document.getElementById("ladder-season-input").addEventListener("change", function() {
				var val = this.value.trim();
				var parsed = parseSeasonInput(val);
				if (parsed) {
					ladderState.season = parsed;
					this.value = ladderState.season;
					ladderState.page = 1;
					loadLadder();
				}
			});

			document.getElementById("btn-search-ladder").addEventListener("click", function() {
				ladderState.search = document.getElementById("ladder-search-input").value.trim();
				ladderState.page = 1;
				loadLadder();
			});
			document.getElementById("ladder-search-input").addEventListener("keydown", function(e) {
				if (e.key === "Enter") {
					ladderState.search = document.getElementById("ladder-search-input").value.trim();
					ladderState.page = 1;
					loadLadder();
				}
			});
			document.getElementById("btn-clear-ladder").addEventListener("click", function() {
				document.getElementById("ladder-search-input").value = "";
				ladderState.search = "";
				ladderState.page = 1;
				loadLadder();
			});
			document.getElementById("btn-refresh-ladder").addEventListener("click", loadLadder);
			document.getElementById("btn-prev-ladder").addEventListener("click", function() {
				if (ladderState.page > 1) {
					ladderState.page--;
					loadLadder();
				}
			});
			document.getElementById("btn-next-ladder").addEventListener("click", function() {
				var totalPages = Math.ceil(ladderState.total / ladderState.pageSize);
				if (ladderState.page < totalPages) {
					ladderState.page++;
					loadLadder();
				}
			});

			// Initial load: Tab 1
			loadRooms();
		})();
	</script>
</body>
</html>`;
}

export class LeaderboardPageController {
	run(req: Request, res: Response): void {
		if (!config.ranking.enabled) {
			res.status(503).json({
				error: "Leaderboard page is currently unavailable (ranking disabled)",
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

		const html = renderLeaderboardPage(format);
		res.type("html").status(200).send(html);
	}
}
