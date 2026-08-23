#!/usr/bin/env node
/**
 * 对局步进延迟压测：建房推进到 MSG_START 后持续对局操作，模拟真实玩家
 * 思考节奏（host 每步随机 1–20s，guest 即时），测量"玩家发出操作 → 服务端
 * 返回下一响应请求"的延迟。
 *
 * 协议同源 scripts/load-test-duel.mjs / smoke-duel.mjs（仓库固定样本）。
 * host 先手（TP_RESULT=1）；引擎 SELECT_* 请求交替轮询双方 —— 脚本按
 * "上一步谁响应"轮流 host（随机思考）/guest（即时），响应均为最小合法值
 * （无动作/否定），对局可持续推进数十回合。
 *
 * 用法：
 *   node scripts/duel-step-latency.mjs --rooms 16 --min-think-ms 1000 --max-think-ms 20000 --duration 120
 *   node scripts/duel-step-latency.mjs --rooms 16 --docker nostalgia-2c4g --cpu-cores 2
 *
 * 指标：step latency = host RESPONSE 发出 → 下一 SELECT 请求帧到达（p50/p95/max）
 * 退出码：0 = 完成；1 = 任一房间失败/超时。
 */

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const RESOURCE_ROOT = path.join(PROJECT_ROOT, "nostalgia-resources");
const CLK_TCK = 100;

const ROOM_BASE = 800000 + Math.floor(Math.random() * 9000) * 100;
const DEFAULT_FORMATS = "1103,1109";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- 参数解析 ----------

function parseArgs(argv) {
	const opts = {
		host: "127.0.0.1",
		port: 706,
		rooms: 16,
		minThinkMs: 1000,
		maxThinkMs: 20000,
		duration: 120,
		formats: DEFAULT_FORMATS.split(","),
		joinTimeoutMs: 8000,
		stageTimeoutMs: 60000,
		pid: null,
		docker: null,
		cpuCores: 1,
		out: null,
	};
	const take = () => argv.shift();
	while (argv.length) {
		const arg = take();
		switch (arg) {
			case "--host":
				opts.host = take();
				break;
			case "--port":
				opts.port = Number(take());
				break;
			case "--rooms":
				opts.rooms = Number(take());
				break;
			case "--min-think-ms":
				opts.minThinkMs = Number(take());
				break;
			case "--max-think-ms":
				opts.maxThinkMs = Number(take());
				break;
			case "--duration":
				opts.duration = Number(take());
				break;
			case "--formats":
				opts.formats = take().split(",");
				break;
			case "--join-timeout-ms":
				opts.joinTimeoutMs = Number(take());
				break;
			case "--stage-timeout-ms":
				opts.stageTimeoutMs = Number(take());
				break;
			case "--pid":
				opts.pid = Number(take());
				break;
			case "--docker":
				opts.docker = take();
				break;
			case "--cpu-cores":
				opts.cpuCores = Number(take());
				break;
			case "--out":
				opts.out = take();
				break;
			case "--help":
				console.log(`对局步进延迟压测
  --rooms <n>            每格式房间数（总并发 = rooms × formats）
  --min-think-ms <ms>    host 每步最小思考时间（默认 1000）
  --max-think-ms <ms>    host 每步最大思考时间（默认 20000）
  --duration <s>         压测持续秒数（默认 120）
  --docker <name>        采样容器内主进程 /proc 指标
  --cpu-cores <n>        目标 CPU 配额核数（verdict：avg CPU < 配额 × 80%）`);
				process.exit(0);
				break;
			default:
				throw new Error(`unknown arg ${arg}`);
		}
	}
	return opts;
}
const opts = parseArgs(process.argv.slice(2));

// ---------- 线协议构造（同 smoke/load-test 同源） ----------

const encodeUtf16LE = (text, slots) => {
	const buffer = Buffer.alloc(slots * 2);
	for (let i = 0; i < Math.min(text.length, slots); i += 1) {
		buffer.writeUInt16LE(text.charCodeAt(i), i * 2);
	}
	return buffer;
};

const buildFrame = (command, payload) => {
	const header = Buffer.alloc(3);
	header.writeUInt16LE(payload.length + 1, 0);
	header.writeUInt8(command, 2);
	return Buffer.concat([header, payload]);
};

const playerInfoFrame = (name) => buildFrame(0x10, encodeUtf16LE(name, 20));
const joinGameFrame = (pass) => {
	const payload = Buffer.alloc(48);
	payload.writeUInt16LE(0x1362, 0);
	payload.writeUInt16LE(0xcccc, 2);
	payload.writeUInt32LE(42, 4);
	encodeUtf16LE(pass, 20).copy(payload, 8);
	return buildFrame(0x12, payload);
};
const updateDeckFrame = (main) => {
	const payload = Buffer.alloc(8 + main.length * 4);
	payload.writeUInt32LE(main.length, 0);
	payload.writeUInt32LE(0, 4);
	let offset = 8;
	for (const code of main) {
		payload.writeUInt32LE(code, offset);
		offset += 4;
	}
	return buildFrame(0x02, payload);
};
const tryStartFrame = () => buildFrame(37, Buffer.alloc(0));
const rpsChoiceFrame = (res) => buildFrame(0x03, Buffer.from([res]));
const orderChoiceFrame = () => buildFrame(0x04, Buffer.from([1])); // host 先手
const responseFrame = (data) => {
	// Commands.RESPONSE = 1（0x03 是 RPS_CHOICE）；ocgcore set_responseb 是
	// 原始字节 memcpy（returns union），不包长度前缀。
	return buildFrame(0x01, data);
};
const surrenderFrame = () => buildFrame(20, Buffer.alloc(0));

// ---------- 真实卡组构造（同 load-test：whitelist qty=3 + base 脚本 + 怪兽） ----------

async function buildDeck(formatId) {
	const lflist = fs.readFileSync(
		path.join(RESOURCE_ROOT, "ygopro", "formats", formatId, "lflist.conf"),
		"utf-8",
	);
	const initSqlJs = (await import("sql.js")).default;
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
			fs.existsSync(path.join(RESOURCE_ROOT, "ygopro", "base", "script", `c${code}.lua`))
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

// ---------- 对局消息解析 ----------

const FRAME_GAME_MSG = 0x01;
// 需要客户端响应的 SELECT_* 游戏消息类型（ygopro-msg-encode identifier）
const SELECT_MSG_TYPES = new Set([
	10, // SELECT_BATTLE_CMD
	11, // SELECT_IDLECMD
	12, // SELECT_EFFECTYN
	13, // SELECT_YESNO
	14, // SELECT_OPTION
	15, // SELECT_CARD
	16, // SELECT_CHAIN
	18, // SELECT_PLACE
	19, // SELECT_POSITION
	20, // SELECT_TRIBUTE
	22, // SELECT_COUNTER
	23, // SELECT_SUM
	24, // SELECT_DISFIELD
	25, // SORT_CARD
	26, // SELECT_UNSELECT_CARD
]);

const parseGameMsgType = (frame) => {
	if (frame.length < 5 || frame[2] !== FRAME_GAME_MSG) {
		return null;
	}
	// 消息类型为 2 字节 LE；playerView 用高位标记视角（如 0x0110 = 对方视角的
	// SELECT_CHAIN(16)），类型取低字节。
	return frame.readUInt16LE(3) & 0xff;
};

// 最小合法响应（现代 ocgcore：returns.ivalue=4 字节小端 / bvalue 数组，无长度前缀。
// SELECT_CHAIN/IDLECMD/BATTLECMD 等用 ivalue；卡选择类用 bvalue[0]=数量=0）。
const minimalResponse = (msgType) => {
	switch (msgType) {
		case 10: // SELECT_BATTLE_CMD: t=3 结束战斗阶段
			return Buffer.from([0x03, 0x00, 0x00, 0x00]);
		case 11: // SELECT_IDLECMD: t=7 结束阶段
			return Buffer.from([0x07, 0x00, 0x00, 0x00]);
		case 13: // SELECT_YESNO: 1 = 是
			return Buffer.from([0x01, 0x00, 0x00, 0x00]);
		case 16: // SELECT_CHAIN: -1 = 不连锁
			return Buffer.from([0xff, 0xff, 0xff, 0xff]);
		case 19: // SELECT_POSITION: 0x1 = 表攻
			return Buffer.from([0x01, 0x00, 0x00, 0x00]);
		case 12: // SELECT_EFFECTYN: 0 = 不发
		case 14: // SELECT_OPTION: 索引 0
			return Buffer.from([0x00, 0x00, 0x00, 0x00]);
		default:
			// 卡选择类（CARD/TRIBUTE/PLACE/UNSELECT/SUM/COUNTER/SORT/DISFIELD）：
			// bvalue 数量 0（空选/无操作）；罕见非法时会 RETRY 重试，无害。
			return Buffer.from([0x00]);
	}
};

// ---------- 连接与开房（同 load-test 时序） ----------

function connect(name, pass) {
	return new Promise((resolve, reject) => {
		const socket = net.connect(opts.port, opts.host, () => {
			socket.write(playerInfoFrame(name));
			socket.write(joinGameFrame(pass));
		});
		const frames = [];
		let buffer = Buffer.alloc(0);
		const fail = (message) => {
			clearInterval(waiter);
			clearTimeout(timeout);
			socket.destroy();
			reject(new Error(message));
		};
		socket.on("error", (error) => fail(`${name}: socket error ${error.message}`));
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
		const timeout = setTimeout(
			() => fail(`${name}: join timeout; got ${frames.map((f) => f[2].toString(16)).join(",")}`),
			opts.joinTimeoutMs,
		);
		const started = Date.now();
		const waiter = setInterval(() => {
			const satisfied = frames.some((f) => f[2] === 0x12) && frames.some((f) => f[2] === 0x13);
			if (satisfied && Date.now() - started > 300) {
				clearInterval(waiter);
				clearTimeout(timeout);
				resolve({ socket, frames });
			}
		}, 50);
	});
}

function waitFor(frames, command, timeoutMs, label) {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const timer = setInterval(() => {
			if (frames.some((f) => f[2] === command)) {
				clearInterval(timer);
				resolve();
			} else if (Date.now() - started > timeoutMs) {
				clearInterval(timer);
				reject(
					new Error(
						`timeout waiting for 0x${command.toString(16)} (${label}); got ${frames
							.map((f) => f[2].toString(16))
							.join(",")}`,
					),
				);
			}
		}, 50);
	});
}

const randomThinkMs = () =>
	Math.floor(opts.minThinkMs + Math.random() * (opts.maxThinkMs - opts.minThinkMs + 1));

// ---------- 单房间步进对局 ----------

async function runRoom({ formatId, roomId, deck }) {
	const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
	const pass = `${formatId}#${roomId}`;

	const host = await connect(`SH-${suffix}`, pass);
	const guest = await connect(`SG-${suffix}`, pass);

	host.socket.write(updateDeckFrame(deck));
	guest.socket.write(updateDeckFrame(deck));
	await sleep(800);

	host.socket.write(tryStartFrame());
	await waitFor(host.frames, 0x15, opts.stageTimeoutMs, "DUEL_START");
	await waitFor(guest.frames, 0x15, opts.stageTimeoutMs, "DUEL_START");

	host.socket.write(rpsChoiceFrame(1));
	guest.socket.write(rpsChoiceFrame(3));
	await waitFor(host.frames, 0x05, opts.stageTimeoutMs, "HAND_RESULT");
	await waitFor(host.frames, 0x04, opts.stageTimeoutMs, "SELECT_TP");
	host.socket.write(orderChoiceFrame());
	await waitFor(host.frames, 0x01, opts.stageTimeoutMs, "MSG_START");

	const stepLatencies = [];
	const done = new Promise((resolve) => {
		const tEnd = Date.now() + opts.duration * 1000;
		let hostFramesSeen = 0;
		let guestFramesSeen = 0;
		let hostThinking = false;
		let hostResponseSentAt = 0; // >0 表示等待该步的反馈帧
		let failed = null;

		const nextSelectType = (frames, fromIndex) => {
			for (let i = frames.length - 1; i >= fromIndex; i -= 1) {
				const type = parseGameMsgType(frames[i]);
				if (type !== null && SELECT_MSG_TYPES.has(type)) {
					return type;
				}
			}
			return null;
		};

		const poll = setInterval(() => {
			if (Date.now() > tEnd) {
				clearInterval(poll);
				host.socket.write(surrenderFrame());
				resolve({ stepLatencies, failed });
				return;
			}

			// guest：收到请求立即响应（不思考，保证对局持续推进）
			const guestSelect = nextSelectType(guest.frames, guestFramesSeen);

			if (guestSelect !== null) {
				guest.socket.write(responseFrame(minimalResponse(guestSelect)));
				guestFramesSeen = guest.frames.length;
			}

			// host：新增请求帧处理（帧是广播的，请求可能指向任一方；非指向
			// host 的响应会被服务器忽略，无害）
			const hostSelect = nextSelectType(host.frames, hostFramesSeen);

			if (hostSelect !== null && !hostThinking) {
				hostFramesSeen = host.frames.length;
				if (hostResponseSentAt > 0) {
					// 上一步的反馈已到：RESPONSE → 服务器推进结果
					stepLatencies.push(Date.now() - hostResponseSentAt);
					hostResponseSentAt = 0;
				}
				// 模拟人类思考节奏后响应
				hostThinking = true;
				setTimeout(() => {
					host.socket.write(responseFrame(minimalResponse(hostSelect)));
					hostResponseSentAt = Date.now();
					hostThinking = false;
				}, randomThinkMs());
			}
		}, 50);
	});

	await done;
	host.socket.destroy();
	guest.socket.destroy();
	return { formatId, roomId, stepLatencies };
}

// ---------- 资源采样（--pid / --docker，同 load-test） ----------

const parseStatCpuTicks = (statText) => {
	const rest = statText.slice(statText.lastIndexOf(")") + 2).split(" ");
	return Number(rest[11]) + Number(rest[12]);
};

const parseStatus = (statustext) => {
	const rss = Number(/VmRSS:\s*(\d+)/.exec(statustext)?.[1] ?? 0);
	const threads = Number(/Threads:\s*(\d+)/.exec(statustext)?.[1] ?? 0);
	return { rss, threads };
};

function sampleServer() {
	try {
		if (opts.pid) {
			const stat = fs.readFileSync(`/proc/${opts.pid}/stat`, "utf-8");
			const status = fs.readFileSync(`/proc/${opts.pid}/status`, "utf-8");
			return { cpu: parseStatCpuTicks(stat), ...parseStatus(status), fds: 0 };
		}
		if (opts.docker) {
			const pid = execSync(
				`docker exec ${opts.docker} sh -c 'pidof node || ls /proc | grep -E "^[0-9]+$" | head -1'`,
				{ encoding: "utf-8" },
			)
				.trim()
				.split(" ")[0];
			const stat = execSync(`docker exec ${opts.docker} cat /proc/${pid}/stat`, {
				encoding: "utf-8",
			}).trim();
			const statusText = execSync(`docker exec ${opts.docker} cat /proc/${pid}/status`, {
				encoding: "utf-8",
			}).trim();
			return { cpu: parseStatCpuTicks(stat), ...parseStatus(statusText), fds: 0 };
		}
	} catch {
		// 采样失败不阻塞压测
	}
	return null;
}

// ---------- 主流程 ----------

const decks = {};
for (const formatId of opts.formats) {
	decks[formatId] = await buildDeck(formatId);
}
const rooms = [];
for (const formatId of opts.formats) {
	for (let i = 0; i < opts.rooms; i += 1) {
		rooms.push({
			formatId,
			roomId: ROOM_BASE + i * opts.formats.length + opts.formats.indexOf(formatId),
			deck: decks[formatId],
		});
	}
}

const baseline = sampleServer();
let lastCpu = baseline?.cpu ?? 0;
let lastSampleAt = Date.now();
const cpuSamples = [];
let maxRss = baseline?.rss ?? 0;
let maxThreads = baseline?.threads ?? 0;

const sampler = setInterval(() => {
	const now = Date.now();
	try {
		const s = sampleServer();
		if (s) {
			cpuSamples.push(((s.cpu - lastCpu) / CLK_TCK / ((now - lastSampleAt) / 1000)) * 100);
			lastCpu = s.cpu;
			lastSampleAt = now;
			maxRss = Math.max(maxRss, s.rss);
			maxThreads = Math.max(maxThreads, s.threads);
		}
	} catch {
		// ignore
	}
}, 1000);

console.log(
	`step-latency mode: ${opts.rooms} room(s) per format ${opts.formats.join(",")}, ` +
		`think ${opts.minThinkMs}-${opts.maxThinkMs}ms, duration ${opts.duration}s`,
);

const results = await Promise.allSettled(rooms.map((r) => runRoom(r)));

clearInterval(sampler);
const avgCpuPct = cpuSamples.length
	? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length
	: null;
const pct = (arr, q) => {
	const sorted = [...arr].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};
const fmt = (ms) => `${ms}ms`;

const allLatencies = [];
let okRooms = 0;
for (const result of results) {
	if (result.status === "fulfilled" && !result.value.failed) {
		okRooms += 1;
		allLatencies.push(...result.value.stepLatencies);
	}
}
const failedRooms = results.filter((r) => r.status === "rejected" || r.value?.failed);

console.log(`rooms: ${okRooms} completed, ${failedRooms.length} failed (total ${rooms.length})`);
for (const r of failedRooms) {
	const detail = r.status === "rejected" ? r.reason.message : r.value.failed;
	console.log(`  failed room: ${detail}`);
}
if (allLatencies.length) {
	console.log(
		`step latency (RESPONSE→next SELECT): p50=${fmt(pct(allLatencies, 0.5))} ` +
			`p95=${fmt(pct(allLatencies, 0.95))} max=${fmt(pct(allLatencies, 1))} (${allLatencies.length} steps)`,
	);
} else {
	console.log("no steps measured");
}
if (avgCpuPct !== null) {
	console.log(
		`server: max RSS ${(maxRss / 1024).toFixed(0)} MB, avg CPU ${avgCpuPct.toFixed(1)}%, ` +
			`max threads ${maxThreads}`,
	);
	console.log(
		`verdict: ${
			failedRooms.length === 0 && (avgCpuPct === null || avgCpuPct < opts.cpuCores * 80)
				? "PASS"
				: "FAIL"
		} (failures=${failedRooms.length}, avg CPU ${(avgCpuPct ?? 0).toFixed(1)}% vs quota ${opts.cpuCores * 80}%)`,
	);
}
process.exit(failedRooms.length === 0 ? 0 : 1);
