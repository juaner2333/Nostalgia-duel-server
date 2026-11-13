import { Request, Response } from "express";

import { config } from "src/config";

const PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>录像回放 · Nostalgia Duel Server</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #14171f; color: #d7dce5; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; min-height: 100vh; }
header { padding: 12px 20px; background: #1c2130; border-bottom: 1px solid #2c3348; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
header h1 { font-size: 17px; font-weight: 600; color: #eef1f7; }
header .meta { font-size: 13px; color: #8b93a7; }
header a.back { color: #6ea8fe; text-decoration: none; font-size: 13px; margin-left: auto; }
.statusbar { display: flex; gap: 18px; align-items: center; padding: 8px 20px; background: #181c28; border-bottom: 1px solid #262c3e; font-size: 13px; flex-wrap: wrap; }
.statusbar .pill { background: #232a3d; border: 1px solid #323b56; border-radius: 12px; padding: 2px 12px; }
.statusbar .pill b { color: #ffd166; font-weight: 600; }
.board { max-width: 980px; margin: 0 auto; padding: 14px 12px; }
.player-panel { border: 1px solid #2a3043; border-radius: 10px; background: #1a1e2b; margin-bottom: 10px; overflow: hidden; }
.player-panel.active-turn { border-color: #ffd166; box-shadow: 0 0 0 1px #ffd16655; }
.player-head { display: flex; align-items: center; gap: 12px; padding: 6px 12px; background: #202638; font-size: 14px; }
.player-head .pname { font-weight: 600; color: #eef1f7; }
.player-head .lp { margin-left: auto; color: #7ee787; font-weight: 700; font-size: 15px; }
.player-head .counts { color: #8b93a7; font-size: 12px; }
.zones { padding: 8px 12px 10px; }
.zrow { display: flex; gap: 6px; justify-content: center; margin-bottom: 6px; }
.zrow:last-child { margin-bottom: 0; }
.cell { width: 15%; max-width: 96px; aspect-ratio: 59 / 70; border: 1px dashed #333c55; border-radius: 6px; background: #141826; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2px; overflow: hidden; position: relative; }
.cell .cname { font-size: 11px; line-height: 1.25; color: #dfe5f0; word-break: break-all; }
.cell .cpos { font-size: 10px; color: #8b93a7; margin-top: 2px; }
.cell.facedown { background: #232021; border-style: solid; }
.cell.facedown .cname { color: #9c8f8f; }
.cell.atk-pos { border-color: #4d6b4d; border-style: solid; }
.cell.def-pos { border-color: #4d5a80; border-style: solid; }
.cell.flash { animation: flash 0.8s ease; }
@keyframes flash { 0% { background: #7a5c1e; } 100% { background: inherit; } }
.hand-row { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; padding: 4px 12px 10px; min-height: 26px; }
.hcard { border: 1px solid #39415c; background: #222842; border-radius: 4px; padding: 3px 7px; font-size: 11px; color: #cfd6e6; }
.hcard.fd { color: #7c8496; background: #1d2130; }
.controls { position: sticky; bottom: 0; background: #1c2130; border-top: 1px solid #2c3348; padding: 10px 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.controls button { background: #2a3350; color: #dfe5f0; border: 1px solid #3a4566; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.controls button:hover { background: #35406280; }
.controls button:disabled { opacity: 0.4; cursor: default; }
.controls select { background: #2a3350; color: #dfe5f0; border: 1px solid #3a4566; border-radius: 6px; padding: 5px 8px; font-size: 13px; }
.controls input[type=range] { flex: 1; min-width: 120px; accent-color: #ffd166; }
.controls .step-info { font-size: 12px; color: #8b93a7; min-width: 90px; text-align: right; }
.logbox { max-width: 980px; margin: 0 auto 12px; padding: 0 12px; }
.loglist { background: #161a26; border: 1px solid #262c3e; border-radius: 8px; height: 180px; overflow-y: auto; font-size: 12px; padding: 6px 0; }
.logitem { padding: 2px 12px; color: #a7b0c4; cursor: pointer; border-left: 2px solid transparent; }
.logitem:hover { background: #1f2536; }
.logitem.current { background: #25304d; border-left-color: #ffd166; color: #eef1f7; }
.logitem .idx { color: #5b6478; margin-right: 8px; }
.loading, .errbox { max-width: 640px; margin: 80px auto; text-align: center; color: #8b93a7; font-size: 14px; }
.errbox { color: #ff7b72; }
.win-banner { text-align: center; padding: 10px; font-size: 16px; font-weight: 700; color: #ffd166; display: none; }
</style>
</head>
<body>
<header>
  <h1 id="title">录像回放</h1>
  <span class="meta" id="subtitle"></span>
  <a class="back" id="backlink" href="#">← 返回决斗专区</a>
</header>
<div class="statusbar">
  <span class="pill">回合 <b id="st-turn">-</b></span>
  <span class="pill">行动玩家 <b id="st-player">-</b></span>
  <span class="pill">阶段 <b id="st-phase">-</b></span>
</div>
<div class="win-banner" id="winbanner"></div>
<div class="board" id="board" style="display:none">
  <div class="player-panel" id="panel-1"></div>
  <div class="player-panel" id="panel-0"></div>
</div>
<div class="loading" id="loading">正在加载并解析录像…</div>
<div class="controls" id="controls" style="display:none">
  <button id="btn-prev" title="上一步">◀</button>
  <button id="btn-play">▶ 播放</button>
  <button id="btn-next" title="下一步">▶|</button>
  <select id="speed">
    <option value="1200">0.5x</option>
    <option value="600" selected>1x</option>
    <option value="300">2x</option>
    <option value="120">5x</option>
  </select>
  <input type="range" id="seek" min="0" max="0" value="0">
  <span class="step-info" id="stepinfo">0 / 0</span>
</div>
<div class="logbox" id="logwrap" style="display:none">
  <div class="loglist" id="loglist"></div>
</div>
<script>
var FORMAT = "__FORMAT__";
var REPLAY_ID = "__REPLAY_ID__";
var API_URL = "/api/replays/" + encodeURIComponent(FORMAT) + "/" + encodeURIComponent(REPLAY_ID) + "/playback";
document.getElementById("backlink").href = "/leaderboards/" + encodeURIComponent(FORMAT) + "?tab=replays";

var LOC = { DECK: 1, HAND: 2, MZONE: 4, SZONE: 8, GRAVE: 16, REMOVED: 32, EXTRA: 64, OVERLAY: 128 };
var PHASES = { 1: "抽卡阶段", 2: "准备阶段", 4: "主要阶段 1", 8: "战斗阶段·开始", 16: "战斗阶段", 32: "伤害步骤", 64: "伤害计算", 128: "战斗阶段", 256: "主要阶段 2", 512: "结束阶段" };
var WIN_REASONS = { 0: "对方生命值归零", 1: "对方认输", 2: "规则胜利", 16: "效果胜利", 17: "对方无卡可抽" };

var data = null;
var cardNames = {};
var step = -1;
var playing = false;
var timer = null;
var state = null;
var logEntries = [];

function freshState() {
  var players = [];
  for (var i = 0; i < 2; i++) {
    players.push({ lp: 8000, mzone: [null, null, null, null, null], szone: [null, null, null, null, null, null], hand: [], deckCount: 0, extraCount: 0, graveCount: 0, removedCount: 0 });
  }
  return { players: players, turn: 0, turnPlayer: 0, phase: 0, winner: null, winType: null };
}

function cname(code) {
  if (!code) return "?";
  return cardNames[String(code)] || ("#" + code);
}
function locOf(m) {
  if (m.card) return m.card;
  if (m.previous) return m.previous;
  return m;
}
function isFacedown(pos) { return pos === 2 || pos === 8 || pos === 10; }
function posText(pos) {
  if (pos === 1) return "表侧攻击";
  if (pos === 4) return "表侧守备";
  if (pos === 2) return "里侧攻击";
  if (pos === 8) return "里侧守备";
  return "";
}

function removeFrom(player, location, sequence) {
  var p = state.players[player];
  if (!p) return null;
  if (location === LOC.MZONE) { var c = p.mzone[sequence]; p.mzone[sequence] = null; return c; }
  if (location === LOC.SZONE) { var c2 = p.szone[sequence]; p.szone[sequence] = null; return c2; }
  if (location === LOC.HAND) { if (sequence >= 0 && sequence < p.hand.length) { return p.hand.splice(sequence, 1)[0]; } return null; }
  if (location === LOC.DECK) { if (p.deckCount > 0) p.deckCount--; return null; }
  if (location === LOC.EXTRA) { if (p.extraCount > 0) p.extraCount--; return null; }
  if (location === LOC.GRAVE) { if (p.graveCount > 0) p.graveCount--; return null; }
  if (location === LOC.REMOVED) { if (p.removedCount > 0) p.removedCount--; return null; }
  return null;
}

function placeTo(player, location, sequence, code, position) {
  var p = state.players[player];
  if (!p) return;
  var card = { code: code, position: position };
  if (location === LOC.MZONE) { p.mzone[sequence] = card; }
  else if (location === LOC.SZONE) { p.szone[sequence] = card; }
  else if (location === LOC.HAND) { if (sequence >= 0 && sequence <= p.hand.length) { p.hand.splice(sequence, 0, card); } else { p.hand.push(card); } }
  else if (location === LOC.DECK) { p.deckCount++; }
  else if (location === LOC.EXTRA) { p.extraCount++; }
  else if (location === LOC.GRAVE) { p.graveCount++; p.lastGrave = code; }
  else if (location === LOC.REMOVED) { p.removedCount++; }
}

function removeFromHandByCode(player, code) {
  var hand = state.players[player].hand;
  for (var i = hand.length - 1; i >= 0; i--) {
    if (hand[i].code === code) { return hand.splice(i, 1)[0]; }
  }
  return null;
}

function addLog(text) {
  logEntries.push(text);
}

function applyMessage(m) {
  var p, card, i;
  switch (m.msgType) {
    case "YGOProMsgStart":
      state.players[0].lp = m.startLp0; state.players[1].lp = m.startLp1;
      state.players[0].deckCount = m.player0.deckCount; state.players[0].extraCount = m.player0.extraCount;
      state.players[1].deckCount = m.player1.deckCount; state.players[1].extraCount = m.player1.extraCount;
      addLog("决斗开始，双方生命值 " + m.startLp0);
      break;
    case "YGOProMsgHandRes":
      var rps = ["?", "石头", "剪刀", "布"];
      addLog("猜拳结果：" + rps[m.result & 3] + " 对 " + rps[(m.result >> 2) & 3]);
      break;
    case "YGOProMsgNewTurn":
      state.turn++; state.turnPlayer = m.player;
      addLog("—— 回合 " + state.turn + " · " + data.playerNames[m.player] + " ——");
      break;
    case "YGOProMsgNewPhase":
      state.phase = m.phase;
      addLog("进入" + (PHASES[m.phase] || ("阶段 " + m.phase)));
      break;
    case "YGOProMsgDraw":
      p = state.players[m.player];
      p.deckCount = Math.max(0, p.deckCount - m.count);
      for (i = 0; i < m.count; i++) { p.hand.push({ code: (m.cards && m.cards[i]) || 0, position: 0 }); }
      addLog(data.playerNames[m.player] + " 抽了 " + m.count + " 张卡");
      break;
    case "YGOProMsgShuffleHand":
      if (m.cards && m.cards.length) { state.players[m.player].hand = m.cards.map(function (c) { return { code: c, position: 0 }; }); }
      addLog(data.playerNames[m.player] + " 洗了手牌");
      break;
    case "YGOProMsgShuffleDeck":
      addLog(data.playerNames[m.player] + " 洗了卡组");
      break;
    case "YGOProMsgShuffleSetCard":
    case "YGOProMsgShuffleExtra":
      break;
    case "YGOProMsgSummoning":
      removeFromHandByCode(m.controller, m.code);
      placeTo(m.controller, m.location, m.sequence, m.code, m.position);
      addLog(data.playerNames[m.controller] + " 召唤「" + cname(m.code) + "」");
      break;
    case "YGOProMsgSummoned":
      addLog("「" + cname(m.code) + "」召唤成功");
      break;
    case "YGOProMsgSpSummoning":
      removeFromHandByCode(m.controller, m.code);
      placeTo(m.controller, m.location, m.sequence, m.code, m.position);
      addLog(data.playerNames[m.controller] + " 特殊召唤「" + cname(m.code) + "」");
      break;
    case "YGOProMsgSpSummoned":
      addLog("「" + cname(m.code) + "」特殊召唤成功");
      break;
    case "YGOProMsgFlipSummoning":
      removeFrom(m.controller, m.location, m.sequence);
      placeTo(m.controller, m.location, m.sequence, m.code, m.position);
      addLog(data.playerNames[m.controller] + " 反转召唤「" + cname(m.code) + "」");
      break;
    case "YGOProMsgFlipSummoned":
      break;
    case "YGOProMsgSet":
      removeFromHandByCode(m.controller, m.code);
      placeTo(m.controller, m.location, m.sequence, m.code, m.position);
      addLog(data.playerNames[m.controller] + " 盖放了「" + cname(m.code) + "」");
      break;
    case "YGOProMsgPosChange":
      card = state.players[m.card.controller] && (m.card.location === LOC.MZONE ? state.players[m.card.controller].mzone[m.card.sequence] : state.players[m.card.controller].szone[m.card.sequence]);
      if (card) { card.position = m.currentPosition; }
      addLog("「" + cname(m.code) + "」变为" + posText(m.currentPosition));
      break;
    case "YGOProMsgMove":
      removeFrom(m.previous.controller, m.previous.location, m.previous.sequence);
      placeTo(m.current.controller, m.current.location, m.current.sequence, m.code, m.current.position);
      break;
    case "YGOProMsgSwap": {
      var a = m.card1, b = m.card2;
      var getSlot = function (loc) { return loc.location === LOC.MZONE ? state.players[loc.controller].mzone : state.players[loc.controller].szone; };
      var za = getSlot(a), zb = getSlot(b);
      var tmp = za[a.sequence]; za[a.sequence] = zb[b.sequence]; zb[b.sequence] = tmp;
      break;
    }
    case "YGOProMsgAttack":
      if (m.defender && (m.defender.location || m.defender.controller)) {
        addLog("「" + cname(cardCodeAt(m.attacker)) + "」攻击「" + cname(cardCodeAt(m.defender)) + "」");
      } else {
        addLog("「" + cname(cardCodeAt(m.attacker)) + "」直接攻击！");
      }
      break;
    case "YGOProMsgBattle":
      addLog("战斗结算：攻方 ATK " + m.attacker.atk + " / 守方 " + (m.defender.atk !== undefined ? "ATK " + m.defender.atk + " DEF " + m.defender.def : "直接攻击"));
      break;
    case "YGOProMsgDamage":
      state.players[m.player].lp -= m.value;
      addLog(data.playerNames[m.player] + " 受到 " + m.value + " 点伤害（LP " + state.players[m.player].lp + "）");
      break;
    case "YGOProMsgRecover":
      state.players[m.player].lp += m.value;
      addLog(data.playerNames[m.player] + " 回复 " + m.value + " 点生命值（LP " + state.players[m.player].lp + "）");
      break;
    case "YGOProMsgPayLpCost":
      state.players[m.player].lp -= m.cost;
      addLog(data.playerNames[m.player] + " 支付 " + m.cost + " 点生命值（LP " + state.players[m.player].lp + "）");
      break;
    case "YGOProMsgLpUpdate":
      state.players[m.player].lp = m.lp;
      break;
    case "YGOProMsgChaining":
      addLog("连锁 " + m.chainCount + "：「" + cname(m.code) + "」发动");
      break;
    case "YGOProMsgChainSolving":
      addLog("连锁 " + m.chainCount + " 处理中");
      break;
    case "YGOProMsgChainSolved":
      addLog("连锁处理完毕");
      break;
    case "YGOProMsgEquip":
      addLog("「" + cname(cardCodeAt(m.equip)) + "」装备给「" + cname(cardCodeAt(m.target)) + "」");
      break;
    case "YGOProMsgTossCoin":
      addLog(data.playerNames[m.player] + " 掷硬币：" + m.results.map(function (r) { return r ? "正面" : "反面"; }).join("、"));
      break;
    case "YGOProMsgTossDice":
      addLog(data.playerNames[m.player] + " 掷骰子：" + m.results.join("、"));
      break;
    case "YGOProMsgConfirmCards":
      if (m.cards && m.cards.length) {
        addLog("确认了 " + m.cards.map(function (c) { return "「" + cname(c.code) + "」"; }).join("、"));
      }
      break;
    case "YGOProMsgDeckTop":
      addLog("确认卡组顶端：「" + cname(m.code) + "」");
      break;
    case "YGOProMsgMissedEffect":
      addLog("「" + cname(m.code) + "」错过了发动时机");
      break;
    case "YGOProMsgBecomeTarget":
      addLog("「" + cname(cardCodeAt(m.targets && m.targets[0])) + "」成为效果对象");
      break;
    case "YGOProMsgUpdateData":
      applyUpdateData(m);
      break;
    case "YGOProMsgUpdateCard":
      applyUpdateCard(m);
      break;
    case "YGOProMsgReloadField":
      applyReloadField(m);
      break;
    case "YGOProMsgWin":
      state.winner = m.player; state.winType = m.type;
      addLog("★ " + data.playerNames[m.player] + " 获胜（" + (WIN_REASONS[m.type] || "原因码 " + m.type) + "）");
      break;
    case "YGOProMsgWaiting":
    case "YGOProMsgHint":
    case "YGOProMsgPlayerHint":
    case "YGOProMsgCardHint":
    case "YGOProMsgDamageStepStart":
    case "YGOProMsgDamageStepEnd":
      break;
    default:
      break;
  }
}

function cardCodeAt(loc) {
  if (!loc) return 0;
  var p = state.players[loc.controller];
  if (!p) return 0;
  var card = null;
  if (loc.location === LOC.MZONE) card = p.mzone[loc.sequence];
  else if (loc.location === LOC.SZONE) card = p.szone[loc.sequence];
  else if (loc.location === LOC.HAND) card = p.hand[loc.sequence];
  return card ? card.code : 0;
}

function applyUpdateData(m) {
  var p = state.players[m.player];
  if (!p || !m.cards) return;
  if (m.location !== LOC.MZONE && m.location !== LOC.SZONE) return;
  var zone = m.location === LOC.MZONE ? p.mzone : p.szone;
  m.cards.forEach(function (q, idx) {
    if (idx >= zone.length) return;
    if (q.empty) { zone[idx] = null; return; }
    var existing = zone[idx];
    var code = q.code !== undefined ? q.code : (existing ? existing.code : 0);
    var position = q.position !== undefined ? q.position : (existing ? existing.position : 0);
    zone[idx] = { code: code, position: position, attack: q.attack, defense: q.defense };
  });
}

function applyUpdateCard(m) {
  var p = state.players[m.controller];
  if (!p || !m.card) return;
  var zone = m.location === LOC.MZONE ? p.mzone : (m.location === LOC.SZONE ? p.szone : null);
  if (!zone || m.sequence >= zone.length) return;
  var existing = zone[m.sequence];
  var q = m.card;
  zone[m.sequence] = {
    code: q.code !== undefined ? q.code : (existing ? existing.code : 0),
    position: q.position !== undefined ? q.position : (existing ? existing.position : 0),
    attack: q.attack !== undefined ? q.attack : (existing ? existing.attack : undefined),
    defense: q.defense !== undefined ? q.defense : (existing ? existing.defense : undefined),
  };
}

function applyReloadField(m) {
  if (!m.players || m.players.length < 2) return;
  for (var i = 0; i < 2; i++) {
    var info = m.players[i];
    var p = state.players[i];
    p.lp = info.lp;
    p.deckCount = info.deckCount; p.extraCount = info.extraCount;
    p.graveCount = info.graveCount; p.removedCount = info.removedCount;
    p.mzone = (info.mzone || []).slice(0, 5).map(function (z) { return z && z.occupied ? { code: 0, position: z.position || 0 } : null; });
    while (p.mzone.length < 5) p.mzone.push(null);
    p.szone = (info.szone || []).slice(0, 6).map(function (z) { return z && z.occupied ? { code: 0, position: z.position || 0 } : null; });
    while (p.szone.length < 6) p.szone.push(null);
    p.hand = [];
    for (var h = 0; h < info.handCount; h++) p.hand.push({ code: 0, position: 0 });
  }
}

function cardHtml(card) {
  if (!card) return "";
  var cls = "cell";
  if (isFacedown(card.position)) cls += " facedown";
  else if (card.position === 1) cls += " atk-pos";
  else if (card.position === 4) cls += " def-pos";
  var stats = "";
  if (!isFacedown(card.position) && card.attack !== undefined) {
    stats = '<div class="cpos">' + card.attack + "/" + (card.defense !== undefined ? card.defense : "?") + "</div>";
  }
  return '<div class="' + cls + '"><div class="cname">' + escapeHtml(cname(card.code)) + '</div><div class="cpos">' + posText(card.position) + "</div>" + stats + "</div>";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; });
}

function renderPlayer(idx) {
  var p = state.players[idx];
  var isTurn = state.turnPlayer === idx;
  var mz = "", sz = "", hand = "";
  var order = idx === 1 ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  order.forEach(function (i) { mz += cardHtml(p.mzone[i]) || '<div class="cell"></div>'; });
  var sorder = idx === 1 ? [5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5];
  sorder.forEach(function (i) { sz += cardHtml(p.szone[i]) || '<div class="cell"></div>'; });
  p.hand.forEach(function (c) {
    hand += '<div class="hcard">' + escapeHtml(cname(c.code)) + "</div>";
  });
  var counts = "卡组 " + p.deckCount + " · 额外 " + p.extraCount + " · 墓地 " + p.graveCount + " · 除外 " + p.removedCount;
  var zonesHtml = idx === 1
    ? '<div class="zrow">' + sz + '</div><div class="zrow">' + mz + "</div>"
    : '<div class="zrow">' + mz + '</div><div class="zrow">' + sz + "</div>";
  return '<div class="player-head"><span class="pname">' + escapeHtml(data.playerNames[idx]) + '</span><span class="counts">' + counts + '</span><span class="lp">LP ' + p.lp + "</span></div>" +
    '<div class="zones">' + zonesHtml + "</div>" +
    '<div class="hand-row">' + (hand || '<span style="color:#5b6478;font-size:11px">（无手牌）</span>') + "</div>";
}

function render() {
  for (var i = 0; i < 2; i++) {
    var panel = document.getElementById("panel-" + i);
    panel.innerHTML = renderPlayer(i);
    panel.className = "player-panel" + (state.turnPlayer === i ? " active-turn" : "");
  }
  document.getElementById("st-turn").textContent = state.turn || "-";
  document.getElementById("st-player").textContent = data.playerNames[state.turnPlayer] || "-";
  document.getElementById("st-phase").textContent = PHASES[state.phase] || "-";
  var banner = document.getElementById("winbanner");
  if (state.winner !== null && state.winner !== undefined) {
    banner.style.display = "block";
    banner.textContent = "★ " + data.playerNames[state.winner] + " 获胜";
  } else {
    banner.style.display = "none";
  }
  document.getElementById("stepinfo").textContent = (step + 1) + " / " + data.messages.length;
  document.getElementById("seek").value = step + 1;
  var items = document.getElementById("loglist").children;
  for (var j = 0; j < items.length; j++) { items[j].className = "logitem" + (j === currentLogIndex() ? " current" : ""); }
  var cur = currentLogIndex();
  if (cur >= 0 && items[cur]) { items[cur].scrollIntoView({ block: "nearest" }); }
}

function currentLogIndex() {
  var li = -1;
  for (var i = 0; i <= step && i < logIndexByStep.length; i++) { if (logIndexByStep[i] >= 0) li = logIndexByStep[i]; }
  return li;
}

var logIndexByStep = [];

/* 预跑一遍生成日志（同时记录每条消息对应的日志序号） */
function precompute() {
  var savedState = freshState();
  var realState = state;
  state = savedState;
  logEntries = [];
  logIndexByStep = [];
  var loglist = document.getElementById("loglist");
  loglist.innerHTML = "";
  var li = 0;
  for (var i = 0; i < data.messages.length; i++) {
    var before = logEntries.length;
    applyMessage(data.messages[i]);
    if (logEntries.length > before) {
      logIndexByStep.push(li);
      for (var k = before; k < logEntries.length; k++) {
        var div = document.createElement("div");
        div.className = "logitem";
        div.innerHTML = '<span class="idx">' + (li + 1) + "</span>" + escapeHtml(logEntries[k]);
        (function (stepIdx) {
          div.addEventListener("click", function () { seekTo(stepIdx); });
        })(i);
        loglist.appendChild(div);
        li++;
      }
    } else {
      logIndexByStep.push(-1);
    }
  }
  state = realState;
}

function seekTo(target) {
  state = freshState();
  logEntries = [];
  for (var i = 0; i <= target && i < data.messages.length; i++) {
    applyMessage(data.messages[i]);
  }
  step = Math.min(target, data.messages.length - 1);
  render();
}

function nextStep() {
  if (step + 1 >= data.messages.length) { pause(); return; }
  step++;
  applyMessage(data.messages[step]);
  render();
}

function pause() {
  playing = false;
  if (timer) { clearInterval(timer); timer = null; }
  document.getElementById("btn-play").textContent = "▶ 播放";
}

function play() {
  playing = true;
  document.getElementById("btn-play").textContent = "⏸ 暂停";
  var interval = parseInt(document.getElementById("speed").value, 10);
  timer = setInterval(function () {
    if (!playing) return;
    nextStep();
  }, interval);
}

document.getElementById("btn-play").addEventListener("click", function () { playing ? pause() : play(); });
document.getElementById("btn-next").addEventListener("click", function () { pause(); nextStep(); });
document.getElementById("btn-prev").addEventListener("click", function () { pause(); if (step > 0) seekTo(step - 1); else seekTo(-1); });
document.getElementById("speed").addEventListener("change", function () { if (playing) { pause(); play(); } });
document.getElementById("seek").addEventListener("input", function () { pause(); seekTo(parseInt(this.value, 10) - 1); });

fetch(API_URL)
  .then(function (res) { return res.json().then(function (body) { return { status: res.status, body: body }; }); })
  .then(function (r) {
    if (!r.body.success) {
      throw new Error(r.body.error || ("HTTP " + r.status));
    }
    data = r.body.data;
    cardNames = data.cardNames || {};
    document.title = data.playerNames[0] + " VS " + data.playerNames[1] + " · 录像回放";
    document.getElementById("title").textContent = data.playerNames[0] + " VS " + data.playerNames[1];
    document.getElementById("subtitle").textContent = "赛制 " + FORMAT + " · 共 " + data.messages.length + " 步";
    if (data.truncated) {
      document.getElementById("subtitle").textContent += " · 录像到此中断（对局可能因断线或超时提前结束）";
    }
    document.getElementById("seek").max = data.messages.length;
    state = freshState();
    precompute();
    seekTo(-1);
    document.getElementById("loading").style.display = "none";
    document.getElementById("board").style.display = "block";
    document.getElementById("controls").style.display = "flex";
    document.getElementById("logwrap").style.display = "block";
  })
  .catch(function (err) {
    document.getElementById("loading").className = "errbox";
    document.getElementById("loading").textContent = "加载失败：" + err.message;
  });
</script>
</body>
</html>
`;

export class ReplayPlayPageController {
	run(req: Request, res: Response): void {
		if (!config.ranking.enabled) {
			res.status(503).send("录像回放当前不可用（排位系统未启用）。");
			return;
		}
		const formatParam = req.params.format;
		const format = Array.isArray(formatParam) ? formatParam[0] : (formatParam ?? "");
		const replayIdParam = req.params.replayId;
		const replayId = Array.isArray(replayIdParam) ? replayIdParam[0] : (replayIdParam ?? "");

		if (!/^[0-9A-Za-z_-]+$/.test(format) || !/^[0-9A-Za-z_-]+$/.test(replayId)) {
			res.status(400).send("无效的录像地址。");
			return;
		}

		res.setHeader("Content-Type", "text/html; charset=utf-8");
		res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
		res.send(PAGE_HTML.replaceAll("__FORMAT__", format).replaceAll("__REPLAY_ID__", replayId));
	}
}
