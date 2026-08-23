#!/usr/bin/env node
/**
 * YGOPro TCP 逐阶段延迟探针脚本。
 *
 * 从测试侧 socket 驱动一次完整决斗（建连 → 加入 → 真实卡组校验 → READY →
 * TRY_START → RPS → 先后手 → 真实 ocgcore WASM MSG_START → 投降收尾），
 * 用 process.hrtime.bigint() 记录每个操作阶段从发出请求到收到服务器确认帧
 * 的耗时（包含网络 RTT + 服务器处理时间），用于实测云服务器上的逐段延迟。
 *
 * 与 scripts/smoke-duel.mjs 使用同源的线协议构造（仓库内固定样本，不依赖
 * 被测代码编码器动态生成期望）。
 *
 * 阶段定义（单位 ms，客户端视角）：
 *   connect      TCP 建连（纯网络 RTT）
 *   join         PlayerInfo/JoinGame → 收到 JOIN_GAME + TYPE_CHANGE
 *   deck         UPDATE_DECK → 收到本人 HS_PLAYER_CHANGE READY（真实卡组校验）
 *   duel_start   TRY_START → DUEL_START
 *   rps          双方 RPS 就绪 → HS_HAND_RESULT
 *   select_tp    HS_HAND_RESULT → SELECT_TP（服务器判定先后手）
 *   engine_start 先后手选择 → MSG_START（真实 ocgcore WASM 加载与开局）
 *   surrender    SURRENDER → MATCH_END（引擎回收）
 *
 * 用法：
 *   node scripts/latency-probe.mjs --host 134.175.22.216 --port 706 --rounds 3
 *
 * 退出码：0 = 全部阶段完成；1 = 任一阶段超时/失败。
 */

const net = await import("node:net").then((m) => m.default);
const fs = await import("node:fs").then((m) => m.default);
const path = await import("node:path").then((m) => m.default);

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const RESOURCE_ROOT = path.join(PROJECT_ROOT, "nostalgia-resources");

// ---------- 参数解析 ----------

const args = {
	host: "127.0.0.1",
	port: 706,
	rounds: 3,
	formats: ["1103", "1109"],
	help: false,
};
for (let i = 2; i < process.argv.length; i += 1) {
	const arg = process.argv[i];
	const take = () => process.argv[++i];
	switch (arg) {
		case "--host":
			args.host = take();
			break;
		case "--port":
			args.port = Number(take());
			break;
		case "--rounds":
			args.rounds = Number(take());
			break;
		case "--formats":
			args.formats = take().split(",");
			break;
		case "-h":
		case "--help":
			args.help = true;
			break;
		default:
			console.error(`unknown arg: ${arg}`);
			process.exit(2);
	}
}
if (args.help) {
	console.log(
		"usage: node scripts/latency-probe.mjs [--host HOST] [--port PORT] [--rounds N] [--formats 1103,1109]",
	);
	process.exit(0);
}

// ---------- wire-format builders（YGOPro 线协议，独立于被测代码） ----------

const encodeUtf16LE = (text, slots) => {
	const buffer = Buffer.alloc(slots * 2);
	for (let i = 0; i < Math.min(text.length, slots); i++) {
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

// ---------- 卡组构造（同 smoke：whitelist qty=3 且有 base 脚本的主卡组怪兽） ----------

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

// ---------- 计时 socket ----------

const toMs = (ns) => Number(ns) / 1e6;

/** 连接并持续累积帧缓冲与每帧到达时刻（hrtime ns）。 */
function createProbe(host, port) {
	return new Promise((resolve, reject) => {
		const startedAt = process.hrtime.bigint();
		const socket = net.connect(port, host);
		const frames = [];
		const times = [];
		let buffer = Buffer.alloc(0);
		socket.on("connect", () => {
			resolve({
				socket,
				frames,
				times,
				connectMs: toMs(process.hrtime.bigint() - startedAt),
			});
		});
		socket.on("error", reject);
		socket.on("data", (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			const now = process.hrtime.bigint();
			while (buffer.length >= 2) {
				const frameLength = buffer.readUInt16LE(0);
				if (frameLength === 0 || buffer.length < 2 + frameLength) {
					break;
				}
				frames.push(buffer.subarray(0, 2 + frameLength));
				times.push(now);
				buffer = buffer.subarray(2 + frameLength);
			}
		});
	});
}

/** 等待命令帧出现 count 次，返回最后一次出现的时刻（ns）。 */
function waitForCommand(probe, command, count = 1, timeoutMs = 20000) {
	return new Promise((resolve, reject) => {
		const started = process.hrtime.bigint();
		const timer = setInterval(() => {
			let seen = 0;
			let lastAt = null;
			for (let i = 0; i < probe.frames.length; i += 1) {
				if (probe.frames[i][2] === command) {
					seen += 1;
					lastAt = probe.times[i];
				}
			}
			if (seen >= count) {
				clearInterval(timer);
				resolve(lastAt);
			} else if (toMs(process.hrtime.bigint() - started) > timeoutMs) {
				clearInterval(timer);
				reject(
					new Error(
						`timeout waiting 0x${command.toString(16)} x${count}; got ${probe.frames
							.map((f) => `0x${f[2].toString(16)}`)
							.join(",")}`,
					),
				);
			}
		}, 25);
	});
}

/** 等待集合内每个命令帧都至少出现一次，返回最后出现的时刻（ns）。 */
function waitForCommands(probe, commands, timeoutMs) {
	return new Promise((resolve, reject) => {
		const started = process.hrtime.bigint();
		const timer = setInterval(() => {
			let lastAt = null;
			let satisfied = true;
			for (const command of commands) {
				let found = false;
				for (let i = 0; i < probe.frames.length; i += 1) {
					if (probe.frames[i][2] === command) {
						found = true;
						lastAt = lastAt === null || probe.times[i] > lastAt ? probe.times[i] : lastAt;
					}
				}
				if (!found) {
					satisfied = false;
				}
			}
			if (satisfied) {
				clearInterval(timer);
				resolve(lastAt);
			} else if (toMs(process.hrtime.bigint() - started) > timeoutMs) {
				clearInterval(timer);
				reject(
					new Error(
						`timeout waiting commands [${commands.map((c) => `0x${c.toString(16)}`).join(",")}]; got ${probe.frames
							.map((f) => `0x${f[2].toString(16)}`)
							.join(",")}`,
					),
				);
			}
		}, 25);
	});
}

/**
 * 等待指定 position（0=host, 1=guest）的 HS_PLAYER_CHANGE READY 广播，
 * status 复合字节高 4 位为 position，低 4 位为 state（READY=9）。
 */
function waitForPlayerReady(probe, position, timeoutMs = 20000) {
	return new Promise((resolve, reject) => {
		const started = process.hrtime.bigint();
		const timer = setInterval(() => {
			let lastAt = null;
			for (let i = 0; i < probe.frames.length; i += 1) {
				const frame = probe.frames[i];
				if (frame[2] === 0x21 && frame.length >= 4 && frame[3] >> 4 === position) {
					lastAt = probe.times[i];
				}
			}
			if (lastAt !== null) {
				clearInterval(timer);
				resolve(lastAt);
			} else if (toMs(process.hrtime.bigint() - started) > timeoutMs) {
				clearInterval(timer);
				reject(
					new Error(
						`timeout waiting READY pos=${position}; got ${probe.frames
							.map((f) => `0x${f[2].toString(16)}`)
							.join(",")}`,
					),
				);
			}
		}, 25);
	});
}

// ---------- 单轮完整流程 ----------

async function runProbe(formatId, roundNo, deck) {
	const suffix = `${formatId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	const pass = `${formatId}#${100000 + Math.floor(Math.random() * 800000)}`;

	const host = await createProbe(args.host, args.port);
	const guest = await createProbe(args.host, args.port);

	// join：写入 PlayerInfo + JoinGame，等 JOIN_GAME + TYPE_CHANGE 确认
	let sentAt = process.hrtime.bigint();
	host.socket.write(playerInfoFrame(`LP-H-${suffix}`));
	host.socket.write(joinGameFrame(pass));
	const hostJoinAt = await waitForCommands(host, [0x12, 0x13], 8000);
	const joinHostMs = toMs(hostJoinAt - sentAt);

	sentAt = process.hrtime.bigint();
	guest.socket.write(playerInfoFrame(`LP-G-${suffix}`));
	guest.socket.write(joinGameFrame(pass));
	const guestJoinAt = await waitForCommands(guest, [0x12, 0x13], 8000);
	const joinGuestMs = toMs(guestJoinAt - sentAt);

	// 卡组校验：UPDATE_DECK → 本人 READY 广播（真实 CDB + 环境 LFList 校验链）
	sentAt = process.hrtime.bigint();
	host.socket.write(updateDeckFrame(deck));
	const hostReadyAt = await waitForPlayerReady(host, 0);
	const deckHostMs = toMs(hostReadyAt - sentAt);

	sentAt = process.hrtime.bigint();
	guest.socket.write(updateDeckFrame(deck));
	const guestReadyAt = await waitForPlayerReady(guest, 1);
	const deckGuestMs = toMs(guestReadyAt - sentAt);

	// TRY_START → DUEL_START
	sentAt = process.hrtime.bigint();
	host.socket.write(tryStartFrame());
	const duelStartAt = await waitForCommand(host, 0x15);
	const duelStartMs = toMs(duelStartAt - sentAt);

	// RPS：host=ROCK(1)、guest=PAPER(3)，双方都发出后开始计时（判定在服务端）
	host.socket.write(rpsChoiceFrame(1));
	const bothSentAt = process.hrtime.bigint();
	guest.socket.write(rpsChoiceFrame(3));
	const handResultAt = await waitForCommand(host, 0x05);
	const rpsMs = toMs(handResultAt - bothSentAt);

	// SELECT_TP（先后手判定下发）
	const selectTpAt = await waitForCommand(host, 0x04);
	const selectTpMs = toMs(selectTpAt - handResultAt);

	// 先后手选择 → MSG_START：真实 ocgcore WASM 加载 + 开局（每场独立 worker）
	sentAt = process.hrtime.bigint();
	host.socket.write(orderChoiceFrame());
	const msgStartAt = await waitForCommand(host, 0x01);
	const engineMs = toMs(msgStartAt - sentAt);

	// 投降 → MATCH_END（引擎回收）
	sentAt = process.hrtime.bigint();
	host.socket.write(surrenderFrame());
	const matchEndAt = await waitForCommand(host, 0x07);
	const surrenderMs = toMs(matchEndAt - sentAt);

	host.socket.destroy();
	guest.socket.destroy();
	await new Promise((resolve) => setTimeout(resolve, 500));

	return {
		connectMs: host.connectMs,
		joinHostMs,
		joinGuestMs,
		deckHostMs,
		deckGuestMs,
		duelStartMs,
		rpsMs,
		selectTpMs,
		engineMs,
		surrenderMs,
	};
}

// ---------- 汇总输出 ----------

const PHASES = [
	["connectMs", "TCP 建连"],
	["joinHostMs", "加入房间 host"],
	["joinGuestMs", "加入房间 guest"],
	["deckHostMs", "卡组校验 host"],
	["deckGuestMs", "卡组校验 guest"],
	["duelStartMs", "开战确认"],
	["rpsMs", "RPS 判定"],
	["selectTpMs", "先后手判定"],
	["engineMs", "引擎启动"],
	["surrenderMs", "投降回收"],
];

function formatTable(formatId, results) {
	console.log(
		`\n=== latency probe: format ${formatId} @ ${args.host}:${args.port} (${results.length} rounds) ===`,
	);
	const header = `phase               |    avg |    max | r1      | r2      | r3      | r4      | r5`;
	console.log(header);
	console.log("-".repeat(header.length));
	for (const [key, label] of PHASES) {
		const values = results.map((r) => r[key]);
		const avg = values.reduce((a, b) => a + b, 0) / values.length;
		const max = Math.max(...values);
		const cells = values.map((v) => v.toFixed(1).padStart(8));
		console.log(
			`${label.padEnd(18)} | ${avg.toFixed(1).padStart(6)} | ${max.toFixed(1).padStart(6)} | ${cells.join(" | ")}`,
		);
	}
}

// ---------- main ----------

async function main() {
	console.log(
		`latency probe: ${args.formats.join(",")} @ ${args.host}:${args.port}, rounds=${args.rounds}`,
	);
	const decks = new Map();
	for (const formatId of args.formats) {
		decks.set(formatId, await buildDeck(formatId));
	}

	for (const formatId of args.formats) {
		const results = [];
		for (let roundNo = 1; roundNo <= args.rounds; roundNo += 1) {
			process.stdout.write(`  ${formatId} round ${roundNo}/${args.rounds} ... `);
			const result = await runProbe(formatId, roundNo, decks.get(formatId));
			results.push(result);
			console.log(
				`done (connect=${result.connectMs.toFixed(1)}ms, engine=${result.engineMs.toFixed(1)}ms)`,
			);
		}
		formatTable(formatId, results);
	}

	console.log("\nPROBE DONE");
	process.exit(0);
}

main().catch((error) => {
	console.error("PROBE FAIL:", error);
	process.exit(1);
});
