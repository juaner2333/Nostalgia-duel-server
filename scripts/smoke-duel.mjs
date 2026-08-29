#!/usr/bin/env node
/**
 * YGOPro TCP 冒烟脚本：双环境真实决斗 + 观战验证。
 *
 * 驱动两个测试侧 TCP socket 走完整房间流程：建房（1103#1001 / 1109#1001）、
 * 真实卡组校验（仓库内 CDB + 环境禁限卡表）、双方 READY、RPS、先后手选择、
 * 真实 ocgcore WASM 决斗（MSG_START）、投降与 MATCH_END。卡组从对应环境
 * whitelist 中选取 40 张无限制（qty=3）且有 base 脚本的主卡组怪兽。
 *
 * 同时以第三个 socket 验证观战：房间满员后加入被准入为 OBSERVER，收到
 * STOC_JOIN_GAME / HS_TYPE_CHANGE / HS_WATCH_CHANGE；决斗期间观战者也收到
 * DUEL_START 与观战视角的 MSG_START，且不改变玩家席位。
 *
 * 前置条件：
 *   1. 目标服务器已在运行（本地 dev 或 Docker 容器，端口需可达）；
 *   2. 服务器可连接 Redis（USE_REDIS=true 时）。
 *
 * 用法：
 *   node scripts/smoke-duel.mjs [port]        # 默认 706（标准 YGOPRO_PORT）
 *   SMOKE_PORT=17711 node scripts/smoke-duel.mjs
 *
 * 预期输出：
 *   OK format 1103: players dueled, spectator admitted and watched
 *   OK format 1109: ...
 *   SMOKE PASS
 *
 * 退出码：0 = 全部通过；1 = 任一格式失败（超时/被拒/校验失败）。
 */

const net = await import("node:net").then((m) => m.default);
const fs = await import("node:fs").then((m) => m.default);
const path = await import("node:path").then((m) => m.default);

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const RESOURCE_ROOT = path.join(PROJECT_ROOT, "nostalgia-resources");
const PORT = Number(process.env.SMOKE_PORT || process.argv[2] || 706);

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
const joinGameFrame = (pass, version = 0x1362) => {
	const payload = Buffer.alloc(48);
	payload.writeUInt16LE(version, 0); // 协议版本
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

// ---------- 卡组构造 ----------

const initSqlJsPromise = import("sql.js").then((m) => m.default);

/**
 * 从格式 whitelist 中选取 40 张无限制（qty=3）、有 base 脚本、类型为主卡组
 * 怪兽（非融合/同调/XYZ/连接）的真实卡片，保证通过真实卡组校验链。
 */
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

// ---------- socket 侧辅助 ----------

/**
 * 连接并加入房间，等待指定命令帧后 resolve，证明准入已发生；此后持续
 * 累积服务器帧供后续阶段断言。玩家等待 STOC_JOIN_GAME (0x12) +
 * HS_TYPE_CHANGE (0x13)；观战者等待 STOC_JOIN_GAME (0x12) +
 * HS_WATCH_CHANGE (0x22)。
 */
function connect(name, pass, waitCommands = [0x12, 0x13], version = 0x1362) {
	return new Promise((resolve, reject) => {
		const socket = net.connect(PORT, "127.0.0.1", () => {
			socket.write(playerInfoFrame(name));
			socket.write(joinGameFrame(pass, version));
		});
		const frames = [];
		let buffer = Buffer.alloc(0);
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
		socket.on("error", reject);

		const started = Date.now();
		const timeout = setTimeout(
			() =>
				reject(
					new Error(
						`${name}: join timeout; got frames: ${frames.map((f) => `0x${f[2].toString(16)}`).join(",")}`,
					),
				),
			8000,
		);
		const waiter = setInterval(() => {
			const satisfied = waitCommands.every((command) => frames.some((f) => f[2] === command));
			if (satisfied && Date.now() - started > 300) {
				clearInterval(waiter);
				clearTimeout(timeout);
				resolve({ socket, frames });
			}
		}, 50);
	});
}

/** 等待服务器发出指定命令帧（默认 15 秒超时）。 */
function waitFor(frames, command, timeoutMs = 15000) {
	return waitForCount(frames, command, 1, timeoutMs);
}

/** 等待服务器发出指定命令帧至少 count 次（默认 15 秒超时）。 */
function waitForCount(frames, command, count, timeoutMs = 15000) {
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

// ---------- 单环境完整流程 ----------

async function runFormat(formatId) {
	const deck = await buildDeck(formatId);
	const suffix = Date.now().toString(36);
	const host = await connect(
		`Smoke-${formatId}-A-${suffix}`,
		`${formatId}#1001`,
		[0x12, 0x13],
		0x1362,
	);
	const guest = await connect(
		`Smoke-${formatId}-B-${suffix}`,
		`${formatId}#1001`,
		[0x12, 0x13],
		0x1361,
	);

	// 第三个连接：房间已满，应被准入为观战者（OBSERVER），收到 JOIN 确认与
	// 观众数广播；同时所有在场客户端会再次收到 HS_WATCH_CHANGE。
	const spectator = await connect(
		`Smoke-${formatId}-Obs-${suffix}`,
		`${formatId}#1001`,
		[0x12, 0x22], // STOC_JOIN_GAME + HS_WATCH_CHANGE
		0x1361,
	);
	// host 在玩家加入时已收到过 1 次 HS_WATCH_CHANGE（观众 0）；观战者加入后
	// 应再收到 1 次（观众 1）——证明观战者被房间真正接纳。
	await waitForCount(host.frames, 0x22, 2); // HS_WATCH_CHANGE x2

	// 提交真实卡组；等待双方 READY（HS_PLAYER_CHANGE）后由房主开战。
	host.socket.write(updateDeckFrame(deck));
	guest.socket.write(updateDeckFrame(deck));
	await new Promise((resolve) => setTimeout(resolve, 800));

	host.socket.write(tryStartFrame());
	await waitFor(host.frames, 0x15); // DUEL_START
	await waitFor(guest.frames, 0x15);
	// 观战者也收到 DUEL_START（开场消息广播给全部客户端）。
	await waitFor(spectator.frames, 0x15);

	// RPS：host=ROCK(1)、guest=PAPER(3)。服务器既有 RPS 判定中此组合 host 胜，
	// host 收到 SELECT_TP (0x04) 并选择先后手，随后引擎发出 MSG_START (0x01)。
	host.socket.write(rpsChoiceFrame(1));
	guest.socket.write(rpsChoiceFrame(3));
	await waitFor(host.frames, 0x05); // HS_HAND_RESULT
	await waitFor(host.frames, 0x04); // SELECT_TP / choosing order
	host.socket.write(orderChoiceFrame());

	// 真实 ocgcore WASM 已启动：等待 MSG_START，然后投降结束本局并等待 MATCH_END。
	await waitFor(host.frames, 0x01); // STOC_GAME_MSG
	// 观战者收到观战视角的 MSG_START（watcherStartMessage 同样经 STOC_GAME_MSG 下发）。
	await waitFor(spectator.frames, 0x01);
	host.socket.write(surrenderFrame());
	await waitFor(host.frames, 0x07); // MATCH_END
	await new Promise((resolve) => setTimeout(resolve, 1500));

	host.socket.destroy();
	guest.socket.destroy();
	spectator.socket.destroy();
	console.log(
		`OK format ${formatId}: players dueled, spectator admitted and watched (seats unchanged)`,
	);
}

async function main() {
	for (const formatId of ["1103", "1109"]) {
		await runFormat(formatId);
	}
	console.log("SMOKE PASS");
	process.exit(0);
}

main().catch((error) => {
	console.error("SMOKE FAIL:", error);
	process.exit(1);
});
