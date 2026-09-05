# 排位房就座超时驱逐机制（Ready/Start 15s 窗口）

## Summary

为直接排位房（`#TT` 匹配房，`room.isDirectRanked === true`）增加就座超时驱逐：

1. **Ready 窗口（15s）**：排位房满 2 人时启动。窗口到期后，仍未准备的玩家被踢出排位房（关闭其 socket，走既有 WAITING 断线清理：释放占用、广播 LEAVE、空房终结）。
2. **Start 窗口（15s）**：双方都准备好后启动。房主 15s 内未按开始（TRY_START），房主被踢出（同上清理），另一名玩家留在房间等待新对手匹配进入（新加入者自动成为 host，见假设 #2）。

两个窗口仅在 `WAITING` 状态、`isDirectRanked` 房间生效；普通复古房（`1103#1001` 等有人为房主的房间）完全不受影响。

## Behavior changes（无协议、无 API、无类型变更）

- 排位等待房（WAITING, isDirectRanked）新增两个一次性计时窗口：
  - `RANKED_READY_WINDOW_MS = 15_000`：房间玩家数到达 2 时武装；到期时若房间仍满员且存在未准备玩家，逐个踢出（跳过 `socket.closed` 的玩家，跳过全部已准备好的情形——即到期时若全员 ready 则自然无操作）。
  - `RANKED_START_WINDOW_MS = 15_000`：`players.length === 2 && allPlayersReady` 的那一刻武装；到期时若仍满员且全员 ready，踢出 host（`room.players.find(p => p.host)`）。
- 触发点（均在 `YGOProWaitingState` 内）：
  - `handleJoin`：入座成功后，`players.length === 2` 时 reconcile（会先取消旧的 start 窗口再武装 ready 窗口）；重连接管路径（takeover）不触碰窗口。
  - `handleUpdateDeck`：setDecksToPlayerUnsafe 之后 reconcile。
  - `handleNotReady`：notReadyUnsafe 之后 reconcile（取消 start 窗口；全员未满 2 或非全员 ready 时若满员则武装/保留 ready 窗口）。
  - `handleTryStart`：开始对局前取消两个窗口。
- 窗口不可被“连续 ready/not-ready 抖动”无限续期：ready 窗口已在运行时不重置（保持从满员时刻起 15s）；start 窗口被 NOT_READY 取消后，下一次全员 ready 重新武装全新 15s。窗口到位后每次 reconcile 先取消旧窗口再按当前状态武装（离开+重新加入满员会得到全新窗口）。
- 到期回调**重校验**（类似 `handleReconnectGraceExpiry` 模式）：仅当 `isDirectRanked && players.length === 2 && !finalizing`（start 窗口还需 `allPlayersReady`）才执行踢出，防止 leave/join/disconnect/takeover 竞态误踢。
- 踢出动作：先给被踢者发一条 STOC_CHAT 通知（`ChatColor.RED`），再 `player.socket.close()`——关闭 socket 触发既有 close→`YGOProDisconnectHandler` WAITING 分支，自动完成：`RankedRoomRegistry.releaseOccupancy`、`room.playerLeave`（LEAVE 广播）、空房时 `FinalizeYGOProRoom.run`。领域层不新增对 room-list/registry 的直接依赖（沿用现有的 close-事件清理管线）。
  - 通知文案：
    - ready 踢出：`15秒内未准备卡组，已移出排位房间。`
    - start 踢出：`房主超过15秒未开始对局，已移出排位房间。`
- 状态机切换/终结时清理：`YGOProWaitingState` 覆写 `removeAllListener()`（先 `super.removeAllListener()` 再清除两个定时器），确保 `rps()`、`disposeRoomState()`、`destroy()` 转场后定时器不残留（定时器不是 emitter 监听器，必须显式清理）。

## Files touched

1. `src/ygopro/room/domain/YGOProRoom.ts`
   - 导出 `RANKED_READY_WINDOW_MS = 15_000`、`RANKED_START_WINDOW_MS = 15_000`。
   - 新增 public 测试缝隙字段（镜像 `reconnectGraceMs` 模式，生产代码永不写入）：`rankedReadyWindowMs` / `rankedStartWindowMs`，默认等于常量；单测用它缩短窗口（fake timers 场景可仍用 15s）。
2. `src/ygopro/room/domain/states/YGOProWaitingState.ts`
   - 新增 `_rankedReadyTimer` / `_rankedStartTimer`、`reconcileRankedDeadlines(room)`、`cancelRankedDeadlines()`、两个到期 handler、`kickPlayers(...)` 帮助方法；在 JOIN/UPDATE_DECK/NOT_READY/TRY_START 四处接入；覆写 `removeAllListener()`；导入 `ChatColor`、`YGOProStocChat`（`ygopro-msg-encode`，项目已有依赖）。
   - 读取窗口时长使用 `room.rankedReadyWindowMs ?? RANKED_READY_WINDOW_MS`（兼容单测 mock 房间无该字段）。
3. `src/ygopro/room/domain/states/YGOProWaitingState.test.ts`
   - 新增 describe 块（jest fake timers + 微任务冲刷助手），覆盖下述用例。
4. `docs/nostalgia-ranked-play-and-leaderboards.md`
   - 新增一小节记录「排位等待房就座超时」行为（15s ready 窗口 / 15s start 窗口、踢出后房间继续参与匹配）。
5. 不触碰 `package.json` / `package-lock.json`（当前工作区已有未提交改动，不属于本任务）。

## Test cases（先写失败测试，SOP-002）

基于 mock room + mock player（`isReady`/`host`/`socket.close`/`sendMessageToClient`），`jest.useFakeTimers()`：

1. 满 2 人且一人未准备：推进 15s → 未准备者 `socket.close` 被调用（host 未准备时也照踢），已准备者不被踢；被踢者收到聊天通知。
2. 双方都未准备：15s 后两人都被踢。
3. 双方按时准备：到期时无人被踢，改为武装 start 窗口；再推进 15s → 仅 host 被踢，guest 保留。
4. host 在 start 窗口内 `TRY_START`：两个窗口都被取消，推进后无踢出。
5. 全员 ready 后有人 `NOT_READY`：start 窗口取消；再次全员 ready 时重新武装全新 15s。
6. 非 `isDirectRanked` 房间：满 2 人且 30s 内无人被踢。
7. `removeAllListener()`（状态转场/终结）后推进时间：无踢出（定时器已清理）。
8. 满 2 人→一人离开→新玩家加入重新满员：ready 窗口重新武装，新未准备玩家到期被踢。
9. 到期重校验：窗口到期时房间已不满员（模拟离开）→ 无踢出。

验证命令：
- `npm test -- src/ygopro/room/domain/states/YGOProWaitingState.test.ts`（聚焦）
- `npm run lint`
- `npm run test`（全量回归）
- `npm run check:nostalgia-resources`（无资源变更，按完成规范顺带跑）
- `npm run build`（涉及生产入口/产物）

现有 `scripts/smoke-ranked-duel.mjs` 走完整准备+开局流程，新窗口不会误触发，无回归风险；不扩展 smoke（等待 15s 会拖慢冒烟）。

## Edge cases / failure modes

- 计时器到期与 join/disconnect 并发：到期回调重校验（满员/ready/finalizing/socket.closed），竞态时直接 no-op。
- 踢出后剩余 1 人：房间保留在匹配池（`DirectNostalgiaRankedJoin` 的 `currentCount < 2` 会把新玩家匹配进来）；新玩家入座时若房内无 host，自动成为 host（`buildPlayer` 既有逻辑）。
- 双方都被踢 → 两个 close 事件各自触发断线清理，`FinalizeYGOProRoom.run` 的 `finalizing` 守卫保证只终结一次。
- 重连（takeover）不重置窗口；被踢后占用量已释放，可立即重新 `#TT` 匹配。
- 无评分/无对局影响：踢出发生在 WAITING，未创建 Match，不影响天梯积分与录像。
- 1103 与 1109 共用机制（机制不感知 format，仅 gate 在 `isDirectRanked`）。

## Assumptions / defaults

1. 两个窗口时长均为 15s（用户明确指定）；以「房间满 2 人」为 ready 窗口起点（符合“排位房间已经有2人”语义）；先到者不会因对手迟到而提前被计时。
2. 踢出房主后**不**解散整个房间：剩余玩家留在房间继续匹配（符合“把房主踢出排位房”字面语义；新加入者自动成为 host 保证对局可开始）。
3. ready 到期时若双方都已准备 → 不踢人（由 start 窗口接管），双方都未准备 → 都踢。
4. 踢出通过关闭 socket 复用既有 WAITING 断线清理管线（close 事件→DisconnectHandler），不在领域层重复实现 registry/room-list 清理；被踢玩家收到一条中文聊天通知后再关闭。
