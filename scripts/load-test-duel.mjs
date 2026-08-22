#!/usr/bin/env node
/**
 * YGOPro TCP 并发决斗压测脚本。
 *
 * 与 scripts/smoke-duel.mjs 使用同源的线协议构造（仓库内固定样本，不依赖被测
 * 代码编码器动态生成期望），驱动真实服务器完成完整决斗流程：
 *   join（PlayerInfo/JoinGame）→ 真实卡组校验 → READY → DUEL_START → RPS →
 *   先后手 → 真实 ocgcore WASM MSG_START → hold → 投降 → MATCH_END。
 *
 * 三种模式：
 *   duel  （默认）每格式并发 --rooms 个房间，全部推进到 MSG_START 后保持
 *         --hold-ms 毫秒，再投降收尾 —— 测量"同时进行中对局数"上限。
 *   churn 在 --duration 秒内循环建房→决斗→投降→关房，--rooms 控制并发窗口，
 *         验证长时间稳定性与内存泄漏。
 *   idle  打开 --connections 个仅发送 PlayerInfo 的挂机连接并保持 --hold-ms，
 *         测量同时在线连接数上限。
 *
 * 服务器资源采样（二选一，不指定则仅输出房间级指标）：
 *   --pid <pid>      直读 /proc/<pid> 的 VmRSS / Threads / CPU / fd（裸进程）
 *   --docker <name>  解析容器内主进程 /proc（docker exec；WSL2 下 docker stats
 *                    CPU 统计失真，故不用）
 *   --cpu-cores <n>  目标 CPU 配额核数（verdict 判定：avg CPU < 配额 × 80%）
 *
 * 用法示例：
 *   node scripts/load-test-duel.mjs --mode duel --rooms 8 --hold-ms 60000 --docker loadtest-server --cpu-cores 2
 *   node scripts/load-test-duel.mjs --mode churn --rooms 4 --duration 1800 --pid 12345
 *   node scripts/load-test-duel.mjs --mode idle --connections 5000 --hold-ms 30000
 *
 * 退出码：0 = 全部通过；1 = 任一房间失败或资源指标越界。
 */

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const RESOURCE_ROOT = path.join(PROJECT_ROOT, "nostalgia-resources");
const CLK_TCK = 100; // Linux USER_HZ，/proc/<pid>/stat 的 CPU 时间单位

// 每次运行使用不同的房间号基址（十进制、适配 JoinGame 20 槽），避免与服务器
// 上残留的旧压测房间碰撞导致"加入旧房间"而非"建房"。
const ROOM_BASE = 900000 + Math.floor(Math.random() * 9000) * 100;
const DEFAULT_FORMATS = "1103,1109";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- 参数解析 ----------

function parseArgs(argv) {
	const opts = {
		mode: "duel",
		host: "127.0.0.1",
		port: 706,
		rooms: 4,
		spectators: 0,
		holdMs: 60000,
		duration: 120,
		connections: 5000,
		formats: DEFAULT_FORMATS.split(","),
		joinTimeoutMs: 8000,
		stageTimeoutMs: 15000,
		pid: undefined,
		docker: undefined,
		out: undefined,
		cpuCores: 1,
		help: false,
	};
	const set = (key, value) => {
		opts[key] = value;
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const take = () => {
			i += 1;
			return argv[i];
		};
		switch (arg) {
			case "--help":
			case "-h":
				opts.help = true;
				break;
			case "--mode":
				set("mode", take());
				break;
			case "--host":
				set("host", take());
				break;
			case "--port":
				set("port", Number(take()));
				break;
			case "--rooms":
				set("rooms", Number(take()));
				break;
			case "--spectators":
				set("spectators", Number(take()));
				break;
			case "--hold-ms":
				set("holdMs", Number(take()));
				break;
			case "--duration":
				set("duration", Number(take()));
				break;
			case "--connections":
				set("connections", Number(take()));
				break;
			case "--formats":
				set(
					"formats",
					take()
						.split(",")
						.map((f) => f.trim())
						.filter(Boolean),
				);
				break;
			case "--join-timeout-ms":
				set("joinTimeoutMs", Number(take()));
				break;
			case "--stage-timeout-ms":
				set("stageTimeoutMs", Number(take()));
				break;
			case "--cpu-cores":
				set("cpuCores", Number(take()));
				break;
			case "--pid":
				set("pid", Number(take()));
				break;
			case "--docker":
				set("docker", take());
				break;
			case "--out":
				set("out", take());
				break;
			default:
				throw new Error(`unknown option: ${arg} (use --help)`);
		}
	}
	if (!opts.formats.length) {
		throw new Error("--formats must list at least one format");
	}
	return opts;
}

function printHelp() {
	console.log(`YGOPro 并发决斗压测脚本

用法:
  node scripts/load-test-duel.mjs [--mode duel|churn|idle] [options]

模式:
  duel   每格式并发 --rooms 个房间，全部推进到 MSG_START 后 hold --hold-ms，再投降收尾
  churn  在 --duration 秒内循环建房→决斗→投降→关房，--rooms 控制并发窗口
  idle   打开 --connections 个挂机连接（仅 PlayerInfo）保持 --hold-ms

选项:
  --host <host>            服务器地址（默认 127.0.0.1）
  --port <port>            YGOPro TCP 端口（默认 706）
  --rooms <n>              每格式并发房间数（默认 4；总并发 = rooms × formats 数）
  --spectators <n>         每房观战连接数（默认 0）
  --hold-ms <ms>           MSG_START 后保持时间（duel/idle，默认 60000）
  --duration <s>           churn 持续秒数（默认 120）
  --connections <n>        idle 挂机连接数（默认 5000）
  --formats <a,b>          环境列表（默认 ${DEFAULT_FORMATS}）
  --join-timeout-ms <ms>   加入房间超时（默认 8000）
  --stage-timeout-ms <ms>  决斗阶段超时（默认 15000）
  --pid <pid>              采样裸进程 /proc 指标
  --docker <name>          采样容器内主进程 /proc 指标（docker exec）
  --cpu-cores <n>          目标 CPU 配额核数（verdict：avg CPU < 配额 × 80%，默认 1）
  --out <path>             采样 CSV 输出路径（默认 /tmp/load-test-<ts>.csv）
  --help                   显示本帮助`);
}

// ---------- 线协议构造（与 scripts/smoke-duel.mjs 同源） ----------

const encodeUtf16LE = (text, slots) => {
	const buffer = Buffer.alloc(slots * 2);
	for (let i = 0; i < Math.min(text.length, slots); i += 1) {
		buffer.writeUInt16LE(text.charCodeAt(i), i * 2);
	}
	return buffer;
};

const buildFrame = (command, payload) => {
	const header = Buffer.alloc(3);
	header.writeUInt16LE(payload.length + 1, 0); // 长度含命令字节
	header.writeUInt8(command, 2);
	return Buffer.concat([header, payload]);
};

const playerInfoFrame = (name) => buildFrame(0x10, encodeUtf16LE(name, 20));
const joinGameFrame = (pass) => {
	const payload = Buffer.alloc(48);
	payload.writeUInt16LE(0x1362, 0); // 协议版本
	payload.writeUInt16LE(0xcccc, 2);
	payload.writeUInt32LE(42, 4);
	encodeUtf16LE(pass, 20).copy(payload, 8);
	return buildFrame(0x12, payload);
};
const updateDeckFrame = (main) => {
	const payload = Buffer.alloc(8 + main.length * 4);
	payload.writeUInt32LE(main.length, 0);
	payload.writeUInt32LE(0, 4); // 无副卡组
	let offset = 8;
	for (const code of main) {
		payload.writeUInt32LE(code, offset);
		offset += 4;
	}
	return buildFrame(0x02, payload);
};
const tryStartFrame = () => buildFrame(37, Buffer.alloc(0));
const rpsChoiceFrame = (res) => buildFrame(0x03, Buffer.from([res]));
const orderChoiceFrame = () => buildFrame(0x04, Buffer.from([1]));
const surrenderFrame = () => buildFrame(20, Buffer.alloc(0));

// ---------- 真实卡组构造（同 smoke-duel.mjs：whitelist qty=3 + base 脚本 + 主卡组怪兽） ----------

const initSqlJsPromise = import("sql.js").then((m) => m.default);

async function buildDeck(formatId) {
	const lflist = fs.readFileSync(
		path.join(RESOURCE_ROOT, "ygopro", "formats", formatId, "lflist.conf"),
		"utf-8",
	);
	const scriptDir = path.join(RESOURCE_ROOT, "ygopro", "base", "script");
	const initSqlJs = await initSqlJsPromise;
	const SQL = await initSqlJs();
	const database = new SQL.Database(
		fs.readFileSync(path.join(RESOURCE_ROOT, "ygopro", "base", "cards.cdb")),
	);
	const result = database.exec("SELECT id, type FROM datas")[0];
	const types = new Map(result.values.map(([id, type]) => [Number(id), Number(type)]));
	const EXTRA_TYPES = 0x40 | 0x2000 | 0x800000 | 0x4000000; // 融合 | 同调 | XYZ | 连接

	const codes = [];
	for (const rawLine of lflist.split(/\r?\n/)) {
		const match = /^(\d+)\s+3(?:\s|$)/.exec(rawLine.trim());
		if (!match) {
			continue;
		}
		const code = Number(match[1]);
		const type = types.get(code) ?? 0;
		if (
			type & 0x1 &&
			!(type & EXTRA_TYPES) &&
			fs.existsSync(path.join(scriptDir, `c${code}.lua`))
		) {
			codes.push(code);
			if (codes.length === 40) {
				break;
			}
		}
	}
	if (codes.length < 40) {
		throw new Error(`format ${formatId}: only ${codes.length} main-deck monsters found`);
	}
	return codes;
}

// ---------- socket 侧辅助（同 smoke-duel.mjs，支持远程 host 与可调超时） ----------

function connect(name, pass, waitCommands = [0x12, 0x13], opts) {
	return new Promise((resolve, reject) => {
		const socket = net.connect(opts.port, opts.host, () => {
			socket.write(playerInfoFrame(name));
			socket.write(joinGameFrame(pass));
		});
		const frames = [];
		let buffer = Buffer.alloc(0);
		let waiter;
		socket.on("data", (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			while (buffer.length >= 2) {
				const frameLength = buffer.readUInt16LE(0);
				if (frameLength === 0 || buffer.length < 2 + frameLength) {
					break;
				}
				frames.push(buffer.subarray(0, 2 + frameLength));
				buffer = buffer.subarray(2 + frameLength);
			}
		});
		const fail = (message) => {
			clearInterval(waiter);
			clearTimeout(timeout);
			socket.destroy();
			reject(new Error(message));
		};
		socket.on("error", (error) => fail(`${name}: socket error ${error.message}`));
		const timeout = setTimeout(
			() =>
				fail(
					`${name}: join timeout; got frames: ${frames.map((f) => `0x${f[2].toString(16)}`).join(",")}`,
				),
			opts.joinTimeoutMs,
		);
		const started = Date.now();
		waiter = setInterval(() => {
			const satisfied = waitCommands.every((command) => frames.some((f) => f[2] === command));
			if (satisfied && Date.now() - started > 300) {
				clearInterval(waiter);
				clearTimeout(timeout);
				resolve({ socket, frames });
			}
		}, 50);
	});
}

function waitFor(frames, command, opts) {
	return waitForCount(frames, command, 1, opts);
}

function waitForCount(frames, command, count, opts) {
	const timeoutMs = opts.stageTimeoutMs;
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const timer = setInterval(() => {
			const seen = frames.filter((f) => f[2] === command).length;
			if (seen >= count) {
				clearInterval(timer);
				resolve();
			} else if (Date.now() - started > timeoutMs) {
				clearInterval(timer);
				reject(
					new Error(
						`timeout waiting for 0x${command.toString(16)} x${count} (seen ${seen}); got ${frames
							.map((f) => f[2])
							.join(",")}`,
					),
				);
			}
		}, 50);
	});
}

// ---------- 单房间完整决斗流程 ----------

async function runRoom({ formatId, roomId, deck, opts, holdMs }) {
	const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
	const pass = `${formatId}#${roomId}`;
	const startedAt = Date.now();
	const sockets = [];

	const host = await connect(`LT-H-${suffix}`, pass, [0x12, 0x13], opts);
	sockets.push(host.socket);
	const tJoin = Date.now() - startedAt;

	const guest = await connect(`LT-G-${suffix}`, pass, [0x12, 0x13], opts);
	sockets.push(guest.socket);

	// 房间满员后，额外连接被准入为观战者（仅验证准入，观战链路由 smoke 覆盖）。
	const watchers = [];
	for (let i = 0; i < opts.spectators; i += 1) {
		const watcher = await connect(`LT-O${i}-${suffix}`, pass, [0x12, 0x22], opts);
		watchers.push(watcher);
		sockets.push(watcher.socket);
	}

	host.socket.write(updateDeckFrame(deck));
	guest.socket.write(updateDeckFrame(deck));
	await sleep(800);

	host.socket.write(tryStartFrame());
	await waitFor(host.frames, 0x15, opts); // DUEL_START
	await waitFor(guest.frames, 0x15, opts);
	const tDuelStart = Date.now() - startedAt;

	// RPS：host=ROCK(1)、guest=PAPER(3)，服务器既有判定 host 胜并选择先后手。
	host.socket.write(rpsChoiceFrame(1));
	guest.socket.write(rpsChoiceFrame(3));
	await waitFor(host.frames, 0x05, opts); // HS_HAND_RESULT
	await waitFor(host.frames, 0x04, opts); // SELECT_TP
	host.socket.write(orderChoiceFrame());
	await waitFor(host.frames, 0x01, opts); // 真实 ocgcore WASM MSG_START
	const tMsgStart = Date.now() - startedAt;

	await sleep(holdMs);
	host.socket.write(surrenderFrame());
	await waitFor(host.frames, 0x07, opts); // MATCH_END
	await sleep(500);

	for (const socket of sockets) {
		socket.destroy();
	}
	return { formatId, roomId, tJoin, tDuelStart, tMsgStart };
}

// ---------- 采样器（--pid 裸进程 / --docker 容器内主进程） ----------

/** /proc/<pid>/stat 的 CPU 时间（tick）：utime + stime（进程全部线程累计）。 */
function parseStatCpuTicks(statText) {
	const rest = statText.slice(statText.lastIndexOf(")") + 2).split(" ");
	return Number(rest[11]) + Number(rest[12]);
}

/** /proc/<pid>/status 的 VmRSS 与 Threads。 */
function parseStatus(statustext) {
	const vm = /^VmRSS:\s+(\d+) kB$/m.exec(statustext);
	const th = /^Threads:\s+(\d+)$/m.exec(statustext);
	return {
		rssMb: vm ? Math.round(Number(vm[1]) / 1024) : null,
		threads: th ? Number(th[1]) : null,
	};
}

/**
 * 解析容器内主进程 PID。主线程 comm 为 MainThread（项目设置），退化依次找
 * node、最小 PID。返回 null 表示无法解析（禁用资源采样）。
 */
function findDockerMainPid(name) {
	const candidates = ["MainThread", "node"];
	for (const comm of candidates) {
		try {
			const script =
				'for p in /proc/[0-9]*; do c=$(cat $p/comm 2>/dev/null); [ "$c" = "' +
				comm +
				'" ] && echo ${p#/proc/}; done | head -1';
			const out = execSync(`docker exec ${name} sh -c '${script}'`, { encoding: "utf8" }).trim();
			if (out) {
				return Number(out);
			}
		} catch {
			// 容器不可达则尝试下一个候选
		}
	}
	return null;
}

function startSampler(opts) {
	const samples = [];
	let prevTicks = null;
	let timer = null;
	let dockerPid = null;

	if (opts.docker) {
		dockerPid = findDockerMainPid(opts.docker);
		if (dockerPid === null) {
			console.log(
				`WARN: cannot resolve main pid in container ${opts.docker}; resource sampling disabled`,
			);
		} else {
			console.log(`sampling container ${opts.docker} main pid ${dockerPid} via docker exec`);
		}
	}

	function sampleOnce() {
		let rssMb = null;
		let cpuPct = null;
		let threads = null;
		let fds = null;
		try {
			if (opts.pid) {
				const status = fs.readFileSync(`/proc/${opts.pid}/status`, "utf8");
				rssMb = parseStatus(status).rssMb;
				threads = parseStatus(status).threads;
				try {
					fds = fs.readdirSync(`/proc/${opts.pid}/fd`).length;
				} catch {
					// 进程可能已退出，fd 目录消失
				}
				const statText = fs.readFileSync(`/proc/${opts.pid}/stat`, "utf8");
				cpuPct = cpuDeltaPct(statText);
			} else if (opts.docker && dockerPid !== null) {
				const script = `cat /proc/${dockerPid}/stat; echo STATUS_BEGIN; grep -E "^(VmRSS|Threads)" /proc/${dockerPid}/status; echo FD_BEGIN; ls /proc/${dockerPid}/fd | wc -l`;
				const out = execSync(`docker exec ${opts.docker} sh -c '${script}'`, { encoding: "utf8" });
				const [statText, statusAndFd] = out.split("STATUS_BEGIN");
				const [statusText, fdText] = statusAndFd.split("FD_BEGIN");
				const parsed = parseStatus(statusText);
				rssMb = parsed.rssMb;
				threads = parsed.threads;
				fds = Number(fdText.trim());
				cpuPct = cpuDeltaPct(statText);
			}
		} catch {
			// 采样失败（进程/容器暂不可达）直接跳过本轮
		}
		samples.push({ at: Date.now(), rssMb, cpuPct, threads, fds });
	}

	function cpuDeltaPct(statText) {
		const ticks = parseStatCpuTicks(statText);
		const now = Date.now();
		if (prevTicks) {
			const dtSeconds = (now - prevTicks.at) / 1000;
			const delta = ticks - prevTicks.ticks;
			prevTicks = { ticks, at: now };
			return dtSeconds > 0 ? (delta / CLK_TCK / dtSeconds) * 100 : null;
		}
		prevTicks = { ticks, at: now };
		return null;
	}

	sampleOnce();
	timer = setInterval(sampleOnce, 1000);
	timer.unref();
	return {
		samples,
		stop() {
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
		},
	};
}

function sampleStats(samples) {
	const rss = samples.filter((s) => s.rssMb !== null).map((s) => s.rssMb);
	const cpu = samples.filter((s) => s.cpuPct !== null).map((s) => s.cpuPct);
	const threads = samples.filter((s) => s.threads !== null).map((s) => s.threads);
	const fds = samples.filter((s) => s.fds !== null).map((s) => s.fds);
	return {
		baselineRssMb: rss.length ? Math.min(...rss) : null,
		maxRssMb: rss.length ? Math.max(...rss) : null,
		avgCpuPct: cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : null,
		maxCpuPct: cpu.length ? Math.max(...cpu) : null,
		maxThreads: threads.length ? Math.max(...threads) : null,
		maxFds: fds.length ? Math.max(...fds) : null,
	};
}

function writeCsv(pathOut, samples) {
	const lines = ["time_ms,rss_mb,cpu_pct,threads,fds"];
	for (const s of samples) {
		lines.push(
			[
				String(s.at),
				s.rssMb ?? "",
				s.cpuPct === null ? "" : s.cpuPct.toFixed(2),
				s.threads ?? "",
				s.fds ?? "",
			].join(","),
		);
	}
	fs.writeFileSync(pathOut, `${lines.join("\n")}\n`);
	console.log(`CSV: ${pathOut}`);
}

// ---------- 汇总 ----------

/**
 * 服务器平均 CPU 相对目标配额（--cpu-cores）的占比。进程 CPU 时间不随核数
 * 变化：裸进程 2 核配额下满负荷可达 200%，docker 模式同样适用。
 */
function cpuQuotaRatio(stats, opts) {
	if (stats.avgCpuPct === null) {
		return null;
	}
	return stats.avgCpuPct / 100 / opts.cpuCores;
}

function percentile(sorted, p) {
	if (sorted.length === 0) {
		return null;
	}
	const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
	return sorted[index];
}

function printLatencies(label, values) {
	if (values.length === 0) {
		return;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const fmt = (v) => (v === null ? "n/a" : `${v}ms`);
	console.log(
		`  ${label}: p50=${fmt(percentile(sorted, 50))} p95=${fmt(percentile(sorted, 95))} max=${fmt(sorted[sorted.length - 1])}`,
	);
}

function printServerStats(stats) {
	const fmtMb = (v) => (v === null ? "n/a" : `${v} MB`);
	const fmtPct = (v) => (v === null ? "n/a" : `${v.toFixed(1)}%`);
	console.log(
		`  server: baseline RSS ${fmtMb(stats.baselineRssMb)}, max RSS ${fmtMb(stats.maxRssMb)}, avg CPU ${fmtPct(stats.avgCpuPct)}, max CPU ${fmtPct(stats.maxCpuPct)}, max threads ${stats.maxThreads ?? "n/a"}, max fds ${stats.maxFds ?? "n/a"}`,
	);
}

// ---------- 三种模式 ----------

async function runDuelMode(opts, deckByFormat, sampler) {
	console.log(
		`duel mode: ${opts.rooms} room(s) per format ${opts.formats.join(",")}, spectators/room=${opts.spectators}, hold=${opts.holdMs}ms`,
	);
	const results = [];
	const failed = [];
	let seq = 0;

	async function runOne(formatId) {
		const roomId = ROOM_BASE + seq;
		seq += 1;
		const label = `${formatId}#${roomId}`;
		try {
			const result = await runRoom({
				formatId,
				roomId,
				deck: deckByFormat.get(formatId),
				opts,
				holdMs: opts.holdMs,
			});
			results.push(result);
			console.log(
				`OK room ${label}: join=${result.tJoin}ms duel_start=${result.tDuelStart}ms msg_start=${result.tMsgStart}ms`,
			);
		} catch (error) {
			failed.push(label);
			console.error(`FAIL room ${label}: ${error.message}`);
		}
	}

	const tasks = [];
	for (const formatId of opts.formats) {
		for (let i = 0; i < opts.rooms; i += 1) {
			tasks.push(runOne(formatId));
		}
	}
	await Promise.all(tasks);

	console.log("== Load test summary (duel) ==");
	console.log(
		`rooms: ${results.length} completed, ${failed.length} failed (total ${results.length + failed.length})`,
	);
	if (failed.length) {
		console.log(`  failed rooms: ${failed.join(", ")}`);
	}
	printLatencies(
		"join",
		results.map((r) => r.tJoin),
	);
	printLatencies(
		"join→DUEL_START",
		results.map((r) => r.tDuelStart),
	);
	printLatencies(
		"join→MSG_START",
		results.map((r) => r.tMsgStart),
	);

	const stats = sampleStats(sampler.samples);
	printServerStats(stats);
	const totalRooms = results.length + failed.length;
	if (stats.baselineRssMb !== null && stats.maxRssMb !== null && totalRooms > 0) {
		const marginal = (stats.maxRssMb - stats.baselineRssMb) / totalRooms;
		console.log(`marginal RSS per room: ${marginal.toFixed(1)} MB`);
	}

	const quotaRatio = cpuQuotaRatio(stats, opts);
	const verdictPass =
		failed.length === 0 &&
		(stats.maxRssMb === null || stats.maxRssMb < 3277) &&
		(quotaRatio === null || quotaRatio < 0.8);
	console.log(`verdict: ${verdictPass ? "PASS" : "FAIL"}`);
	return verdictPass;
}

async function runChurnMode(opts, deckByFormat, sampler) {
	console.log(
		`churn mode: ${opts.duration}s, concurrent window=${opts.rooms}, formats ${opts.formats.join(",")}`,
	);
	const deadline = Date.now() + opts.duration * 1000;
	let seq = 0;
	let active = 0;
	let completed = 0;
	let failed = 0;
	const startedAt = Date.now();

	async function runOne(formatId) {
		const roomId = ROOM_BASE + seq;
		seq += 1;
		const label = `${formatId}#${roomId}`;
		try {
			await runRoom({ formatId, roomId, deck: deckByFormat.get(formatId), opts, holdMs: 0 });
			completed += 1;
			console.log(`OK room ${label} (${completed} done)`);
		} catch (error) {
			failed += 1;
			console.error(`FAIL room ${label}: ${error.message}`);
		}
	}

	while (Date.now() < deadline) {
		if (active < opts.rooms) {
			active += 1;
			const formatId = opts.formats[seq % opts.formats.length];
			void runOne(formatId).finally(() => {
				active -= 1;
			});
		} else {
			await sleep(50);
		}
	}
	while (active > 0) {
		await sleep(100);
	}

	console.log("== Load test summary (churn) ==");
	console.log(`rooms: ${completed} completed, ${failed} failed over ${opts.duration}s`);

	const stats = sampleStats(sampler.samples);
	printServerStats(stats);

	// 泄漏检查：前 2 分钟与后 2 分钟平均 RSS 对比。
	const rssSamples = sampler.samples.filter((s) => s.rssMb !== null);
	let leakOk = null;
	if (rssSamples.length >= 4) {
		const elapsed = rssSamples[rssSamples.length - 1].at - startedAt;
		const windowMs = Math.min(120000, elapsed / 2);
		const first = rssSamples.filter((s) => s.at - startedAt <= windowMs);
		const last = rssSamples.filter((s) => s.at - startedAt >= elapsed - windowMs);
		const avg = (list) => list.reduce((a, b) => a + b.rssMb, 0) / list.length;
		const firstAvg = avg(first);
		const lastAvg = avg(last);
		leakOk = lastAvg - firstAvg < 200;
		console.log(
			`leak check: first ${windowMs / 1000}s avg RSS ${firstAvg.toFixed(0)} MB, last ${windowMs / 1000}s avg RSS ${lastAvg.toFixed(0)} MB → ${leakOk ? "OK" : "LEAK SUSPECTED"}`,
		);
	}

	const quotaRatio = cpuQuotaRatio(stats, opts);
	const verdictPass =
		failed === 0 &&
		(stats.maxRssMb === null || stats.maxRssMb < 3277) &&
		(quotaRatio === null || quotaRatio < 0.8) &&
		leakOk !== false;
	console.log(`verdict: ${verdictPass ? "PASS" : "FAIL"}`);
	return verdictPass;
}

async function runIdleMode(opts, sampler) {
	console.log(`idle mode: ${opts.connections} connections, hold=${opts.holdMs}ms`);
	const sockets = [];
	const suffix = Date.now().toString(36);
	let failedToOpen = 0;
	const BATCH = 500;
	const batchDelayMs = 200;

	for (let i = 0; i < opts.connections; i += BATCH) {
		const batchSize = Math.min(BATCH, opts.connections - i);
		await Promise.all(
			Array.from({ length: batchSize }, (_, k) => {
				const index = i + k;
				return new Promise((resolve) => {
					const socket = net.connect(opts.port, opts.host, () => {
						socket.write(playerInfoFrame(`Idle-${index}-${suffix}`));
					});
					socket.once("error", () => {
						failedToOpen += 1;
						resolve();
					});
					socket.once("connect", resolve);
					setTimeout(resolve, 5000).unref(); // 兜底，避免连接失败时卡死
					sockets.push(socket);
				});
			}),
		);
		await sleep(batchDelayMs);
	}
	await sleep(opts.holdMs);

	const alive = sockets.filter((s) => s.readyState === "open").length;
	for (const socket of sockets) {
		socket.destroy();
	}

	console.log("== Load test summary (idle) ==");
	console.log(
		`connections: ${alive} alive / ${opts.connections} opened, ${failedToOpen} failed to open`,
	);
	const stats = sampleStats(sampler.samples);
	printServerStats(stats);
	if (stats.baselineRssMb !== null && stats.maxRssMb !== null && opts.connections > 0) {
		const marginal = ((stats.maxRssMb - stats.baselineRssMb) / opts.connections) * 1000;
		console.log(`marginal RSS per 1000 connections: ${marginal.toFixed(1)} MB`);
	}
	const verdictPass = alive >= opts.connections * 0.99 && failedToOpen === 0;
	console.log(`verdict: ${verdictPass ? "PASS" : "FAIL"}`);
	return verdictPass;
}

// ---------- 入口 ----------

async function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`argument error: ${error.message}`);
		printHelp();
		process.exit(2);
	}
	if (opts.help) {
		printHelp();
		process.exit(0);
	}
	if (!["duel", "churn", "idle"].includes(opts.mode)) {
		console.error(`argument error: unknown mode '${opts.mode}'`);
		process.exit(2);
	}
	if (!opts.pid && !opts.docker) {
		console.log("(no --pid/--docker: server resource metrics will not be sampled)");
	}

	const sampler = startSampler(opts);
	let pass = false;
	try {
		if (opts.mode === "idle") {
			pass = await runIdleMode(opts, sampler);
		} else {
			const deckByFormat = new Map();
			for (const formatId of opts.formats) {
				deckByFormat.set(formatId, await buildDeck(formatId));
			}
			if (opts.mode === "churn") {
				pass = await runChurnMode(opts, deckByFormat, sampler);
			} else {
				pass = await runDuelMode(opts, deckByFormat, sampler);
			}
		}
	} finally {
		sampler.stop();
	}

	const csvPath = opts.out ?? `/tmp/load-test-${Date.now()}.csv`;
	writeCsv(csvPath, sampler.samples);
	console.log(pass ? "LOAD TEST PASS" : "LOAD TEST FAIL");
	process.exit(pass ? 0 : 1);
}

main().catch((error) => {
	console.error("LOAD TEST ERROR:", error);
	process.exit(1);
});
