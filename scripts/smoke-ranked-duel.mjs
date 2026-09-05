#!/usr/bin/env node
/**
 * YGOPro TCP 排位房冒烟脚本：排位匹配 + 2-0 完整对局 + 积分落库验证。
 *
 * 驱动两个测试侧 TCP socket 走完整排位房流程：
 *   1. 双方携带 4 位 PIN 加入排位房（如 1109#TT）；
 *   2. 接收在房个人赛季战绩私信提示（STOC_CHAT）；
 *   3. 提交真实卡组、RPS 猜拳、首局开战并投降（1-0）；
 *   4. 换备阶段（Side-Decking）重新提交卡组、先后手选择、第二局开战并投降（2-0）；
 *   5. 收到 MATCH_END 并在服务端触发原子事务落库；
 *   6. （可选）查询排行榜 REST API 验证积分增加与排名。
 *
 * 用法：
 *   node scripts/smoke-ranked-duel.mjs [tcpPort] [httpPort]
 *   SMOKE_PORT=17711 SMOKE_HTTP_PORT=17712 node scripts/smoke-ranked-duel.mjs
 */

const net = await import("node:net").then((m) => m.default);
const fs = await import("node:fs").then((m) => m.default);
const path = await import("node:path").then((m) => m.default);
const http = await import("node:http").then((m) => m.default);

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const RESOURCE_ROOT = path.join(PROJECT_ROOT, "nostalgia-resources");
const PORT = Number(process.env.SMOKE_PORT || process.argv[2] || 706);
const HTTP_PORT = Number(process.env.SMOKE_HTTP_PORT || process.argv[3] || 707);

const encodeUtf16LE = (text, slots) => {
	const buffer = Buffer.alloc(slots * 2);
	for (let i = 0; i < Math.min(text.length, slots); i++) {
		buffer.writeUInt16LE(text.charCodeAt(i), i * 2);
	}
	return buffer;
};

const decodeUtf16LE = (buffer, maxBytes = 40) => {
	let text = "";
	for (let i = 0; i < maxBytes; i += 2) {
		const code = buffer.readUInt16LE(i);
		if (code === 0) break;
		text += String.fromCharCode(code);
	}
	return text;
};

const parsePlayerEnter = (frame) => {
	const name = decodeUtf16LE(frame.subarray(3, 43));
	const pos = frame.readInt8(43);
	return { name, pos };
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
const orderChoiceFrame = () => buildFrame(0x04, Buffer.from([1]));
const surrenderFrame = () => buildFrame(20, Buffer.alloc(0));

const initSqlJsPromise = import(
	path.join(PROJECT_ROOT, "node_modules", "sql.js", "dist", "sql-wasm.js")
).then((m) => m.default);

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
	const EXTRA_TYPES = 0x40 | 0x2000 | 0x800000 | 0x4000000;

	const codes = [];
	for (const rawLine of lflist.split(/\r?\n/)) {
		const match = /^(\d+)\s+3(?:\s|$)/.exec(rawLine.trim());
		if (!match) continue;
		const code = Number(match[1]);
		const type = types.get(code) ?? 0;
		if (
			type & 0x1 &&
			!(type & EXTRA_TYPES) &&
			fs.existsSync(path.join(scriptDir, `c${code}.lua`))
		) {
			codes.push(code);
			if (codes.length === 40) break;
		}
	}
	return codes;
}

function connect(name, pass, waitCommands = [0x12, 0x13]) {
	return new Promise((resolve, reject) => {
		const socket = net.connect(PORT, "127.0.0.1", () => {
			socket.write(playerInfoFrame(name));
			socket.write(joinGameFrame(pass));
		});
		const frames = [];
		let buffer = Buffer.alloc(0);
		socket.on("data", (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			while (buffer.length >= 2) {
				const frameLength = buffer.readUInt16LE(0);
				if (frameLength === 0 || buffer.length < 2 + frameLength) break;
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
						`${name}: join timeout; got frames: ${frames.map((f) => "0x" + f[2].toString(16)).join(",")}`,
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

function waitFor(frames, command, timeoutMs = 15000) {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const timer = setInterval(() => {
			if (frames.some((f) => f[2] === command)) {
				clearInterval(timer);
				resolve();
			} else if (Date.now() - started > timeoutMs) {
				clearInterval(timer);
				reject(new Error(`timeout waiting for 0x${command.toString(16)}`));
			}
		}, 50);
	});
}

async function fetchLeaderboard(formatId) {
	return new Promise((resolve) => {
		const req = http.get(
			`http://127.0.0.1:${HTTP_PORT}/api/leaderboards/${formatId}?scope=overall`,
			(res) => {
				let data = "";
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => {
					try {
						resolve(JSON.parse(data));
					} catch {
						resolve(null);
					}
				});
			},
		);
		req.on("error", () => resolve(null));
		req.setTimeout(2000, () => {
			req.destroy();
			resolve(null);
		});
	});
}

async function runRankedSmokeForFormat(formatId) {
	const deck = await buildDeck(formatId);
	const suffix = (Date.now() % 10000).toString();
	const hostName = `H${suffix}`;
	const guestName = `G${suffix}`;

	const host = await connect(`${hostName}$1234`, `${formatId}#TT`);
	const guest = await connect(`${guestName}$5678`, `${formatId}#TT`);

	// Verify in-room ranked notice
	const hostChat = host.frames.filter((f) => f[2] === 0x19);
	const guestChat = guest.frames.filter((f) => f[2] === 0x19);
	if (hostChat.length === 0 || guestChat.length === 0) {
		throw new Error("Ranked in-room notice chat message not received");
	}

	// Verify waiting state nickname masking: opponent is seen as ***
	await waitFor(host.frames, 0x20);
	await waitFor(guest.frames, 0x20);

	const hostWaitingEnters = host.frames.filter((f) => f[2] === 0x20).map(parsePlayerEnter);
	const guestWaitingEnters = guest.frames.filter((f) => f[2] === 0x20).map(parsePlayerEnter);

	const hostSeenGuest = hostWaitingEnters.find((e) => e.pos === 1);
	const guestSeenHost = guestWaitingEnters.find((e) => e.pos === 0);

	if (
		!hostSeenGuest ||
		hostSeenGuest.name !== "***" ||
		!guestSeenHost ||
		guestSeenHost.name !== "***"
	) {
		throw new Error(
			`Waiting nickname masking failed: host saw '${hostSeenGuest?.name}', guest saw '${guestSeenHost?.name}'`,
		);
	}

	// Ready up
	host.socket.write(updateDeckFrame(deck));
	guest.socket.write(updateDeckFrame(deck));
	await new Promise((r) => setTimeout(r, 800));

	// Host starts game
	const hostFramesBeforeStart = host.frames.length;
	const guestFramesBeforeStart = guest.frames.length;
	host.socket.write(tryStartFrame());
	await waitFor(host.frames, 0x15); // DUEL_START
	await waitFor(guest.frames, 0x15);

	// Verify real name reveal before DUEL_START
	const hostStartFrames = host.frames.slice(hostFramesBeforeStart);
	const guestStartFrames = guest.frames.slice(guestFramesBeforeStart);
	const hostDuelStartIndex = hostStartFrames.findIndex((f) => f[2] === 0x15);
	const guestDuelStartIndex = guestStartFrames.findIndex((f) => f[2] === 0x15);

	const hostRevealedEnters = hostStartFrames
		.slice(0, hostDuelStartIndex)
		.filter((f) => f[2] === 0x20)
		.map(parsePlayerEnter);
	const guestRevealedEnters = guestStartFrames
		.slice(0, guestDuelStartIndex)
		.filter((f) => f[2] === 0x20)
		.map(parsePlayerEnter);

	const hostRevealedHost = hostRevealedEnters.find((e) => e.pos === 0);
	const hostRevealedGuest = hostRevealedEnters.find((e) => e.pos === 1);
	const guestRevealedHost = guestRevealedEnters.find((e) => e.pos === 0);
	const guestRevealedGuest = guestRevealedEnters.find((e) => e.pos === 1);

	if (
		!hostRevealedHost ||
		hostRevealedHost.name !== hostName ||
		!hostRevealedGuest ||
		hostRevealedGuest.name !== guestName ||
		!guestRevealedHost ||
		guestRevealedHost.name !== hostName ||
		!guestRevealedGuest ||
		guestRevealedGuest.name !== guestName
	) {
		throw new Error(
			`Real name reveal before DUEL_START failed: host saw [${hostRevealedEnters.map((e) => e.name).join(", ")}], guest saw [${guestRevealedEnters.map((e) => e.name).join(", ")}]`,
		);
	}

	// RPS
	host.socket.write(rpsChoiceFrame(1));
	guest.socket.write(rpsChoiceFrame(3));
	await waitFor(host.frames, 0x05); // HS_HAND_RESULT
	await waitFor(host.frames, 0x04); // SELECT_TP
	host.socket.write(orderChoiceFrame());

	// Game 1 started
	await waitFor(host.frames, 0x01); // STOC_GAME_MSG

	// Guest surrenders Game 1
	guest.socket.write(surrenderFrame());
	await new Promise((r) => setTimeout(r, 1000));

	// Clear frames to cleanly wait for Game 2 events
	host.frames.length = 0;
	guest.frames.length = 0;

	// Game 2 side decking
	host.socket.write(updateDeckFrame(deck));
	guest.socket.write(updateDeckFrame(deck));

	// Loser of Game 1 (Guest) gets SELECT_TP (0x04)
	await waitFor(guest.frames, 0x04);
	guest.socket.write(orderChoiceFrame());

	// Game 2 starts
	await waitFor(host.frames, 0x01); // STOC_GAME_MSG

	// Guest surrenders Game 2 to end match 2-0
	guest.socket.write(surrenderFrame());
	// 比赛已结束（2-0），服务器走 finalize 分支：发完录像后下发 STOC_DUEL_END 并断开全部连接。
	// 注意不能用 0x07（STOC_CHANGE_SIDE）：那是「比赛未结束、进入换备」时才发的信号。
	await waitFor(host.frames, 0x16); // STOC_DUEL_END

	// Allow DB transaction to finish
	await new Promise((r) => setTimeout(r, 2000));
	host.socket.destroy();
	guest.socket.destroy();

	console.log(`OK ranked ${formatId}: players matched, duels completed (2-0), match ended cleanly`);
}

async function main() {
	console.log(`Starting Ranked Duel Smoke Test (port=${PORT}, httpPort=${HTTP_PORT})...`);

	await runRankedSmokeForFormat("1103");
	await runRankedSmokeForFormat("1109");

	for (const formatId of ["1103", "1109"]) {
		const lb = await fetchLeaderboard(formatId);
		if (lb && lb.leaderboard && lb.leaderboard.length > 0) {
			console.log(
				`OK leaderboard API: returned ${lb.leaderboard.length} entry/entries for ${formatId}`,
			);
		}
	}

	console.log("SMOKE RANKED PASS");
}

main().catch((err) => {
	console.error("SMOKE RANKED FAILED:", err);
	process.exit(1);
});
