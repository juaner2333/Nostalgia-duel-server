# YGOPro 跨局遗留响应计时器误判超时修复计划

## 1. 摘要

修复旧对局的 `TIME_CONFIRM` 异步重排在 OCGCore 已销毁后继续创建计时器，导致该计时器跨越换备阶段并在下一局触发 `FINISH_DUEL_BY_TIMEOUT`、错误判负当前玩家的问题。

本计划采用最小生命周期修复：

- OCGCore 一旦进入 dispose，禁止再发送新的响应计时、调度 `TimerState` 或发布超时判负事件；
- 在异步 `sendTimeLimitMessage()` 返回后重新检查生命周期，封住本次事故的实际竞态窗口；
- 先用可控 Promise 与 Jest fake timers 复现竞态，再修改生产代码；
- 不改变 450 秒计时长度、每回合恢复规则、YGOPro 线协议、投降语义或房间状态机；
- 不修改固定资源、数据库或公开接口。

## 2. 已确认的生产证据

### 2.1 事故时间线

北京时间 2026-08-27，内部房间 `4663` 的关键事件如下：

| 时间 | 事件 |
| --- | --- |
| 09:58:12.921 | 第二局中的响应计时收到 `TIME_CONFIRM` |
| 09:58:24.489 | 同一个 TCP 数据块包含 `SURRENDER (0x14)` 和紧随其后的 `TIME_CONFIRM (0x15)` |
| 09:58:24.490 | 第二局按投降结束，比分变为 1:1，并记录 `OCGCore disposed` |
| 09:59:13.008 | 第三局选择先后手并创建新的 OCGCore |
| 10:05:43.557 | 玩家仍在正常发送 `TIME_CONFIRM` |
| 10:05:43.991 | 服务端记录 `Response timeout originalDuelPos=1`，第三局被判超时，最终比分 2:1 |

线上固定环境的 `time_limit` 为 450 秒。第三局从 09:59:13 到 10:05:43 仅约 391 秒，因此当前局不可能正常耗尽 450 秒。

### 2.2 时间差与遗留计时器吻合

第二局最后一次计时从约 09:58:13.991 开始。投降时已经消耗约 10.5 秒，剩余时间约为：

```text
450s - 10.5s = 439.5s
```

若投降时的并发 `TIME_CONFIRM` 在 dispose 后错误重建该计时器，则到期时间为：

```text
09:58:24.490 + 439.5s = 10:05:43.990
```

这与生产日志的 `10:05:43.991` 误判时间一致，误差约 1ms。

### 2.3 已排除项

- 容器无重启、无 OOM、无异常退出；
- 判负前约 0.43 秒仍收到玩家消息，不属于玩家长时间无响应；
- 当前容器启动后仅出现这一次 `Response timeout`；
- 主机时间同步正常，日志未发现时钟跳变；
- 线上编译产物与仓库均明确配置 `time_limit: 450`。

## 3. 根因

同一 TCP 数据块中的两个命令会分别触发异步事件处理器，但事件派发不等待前一个异步处理完成：

1. `SURRENDER` 进入 `handleSurrender()`，开始结束当前局；
2. 紧随其后的 `TIME_CONFIRM` 同时进入 `handleTimeConfirm()`；
3. `rescheduleTimerAfterConfirm()` 计算剩余时间，进入 `setResponseTimer()`；
4. `setResponseTimer()` 清除旧 timer 后，`await sendTimeLimitMessage()` 主动让出执行权；
5. 投降流程继续执行，调用 `dispose()`、清理计时状态并切换到换备阶段；
6. `sendTimeLimitMessage()` 完成后，旧 OCGCore 的异步流程恢复；当前实现未重新检查 `isDisposing`/worker 状态，继续调用 `TimerState.schedule()`；
7. 该孤儿 timer 不再受已经完成的 dispose 清理；到期后通过房间共享 EventEmitter 发布 `FINISH_DUEL_BY_TIMEOUT`；
8. 此时第三局的 `YGOProDuelingState` 已监听同名事件，于是把第二局的旧 timer 当作第三局超时处理。

根因位于 OCGCore 生命周期边界，而不是 `TimerState` 的计时计算或协议解析。

## 4. 目标与非目标

### 4.1 目标

- 已销毁 OCGCore 的所有在途异步流程都不能重新创建响应计时器；
- 已销毁 OCGCore 的残留 callback 不能发布超时判负事件；
- 正常对局的响应计时、`TIME_CONFIRM` 补偿和合法超时行为保持不变；
- 用确定性单元测试永久覆盖本次 Promise 交错顺序。

### 4.2 非目标

- 不调整 450 秒时限或每回合恢复策略；
- 不串行化或重写整个房间 EventEmitter；
- 不引入 generation token、AbortController、Mutex 或新依赖；
- 不修改 `TimerState` 的通用实现；
- 不修改客户端、TCP 帧格式、固定资源、数据库或统计结构；
- 不在本变更中直接部署生产环境。

## 5. 执行步骤（测试优先）

### 5.1 添加失败的竞态回归测试

在 `src/ygopro/ocgcore-worker/ocgcore.test.ts` 增加独立的响应计时生命周期用例，复用现有真实 `OCGCore`、`YGOProRoomMother`、fake worker 和 Logger stub。

测试按以下顺序精确制造生产交错：

1. 启用 Jest fake timers；
2. 创建 OCGCore 并注入可正常 dispose 的 fake worker；
3. 调用 `resetResponseRequestState()`，得到 450 秒初始时间；
4. 为位置 1 建立 active timer，并推进 10.5 秒；
5. 将 `sendTimeLimitMessage()` 替换为受 deferred Promise 控制的实现；
6. 调用 `rescheduleTimerAfterConfirm(1)`，让流程暂停在异步发送；
7. 在 Promise 未完成时调用 `dispose()`；
8. 释放 deferred Promise，让旧重排流程恢复；
9. 推进剩余约 439.5 秒；
10. 断言：
   - 房间未收到 `FINISH_DUEL_BY_TIMEOUT`；
   - Logger 未记录 `Response timeout`；
   - timer state 不存在运行中的位置；
   - fake worker 只 dispose 一次。

在修改生产代码前运行该用例并确认失败，失败表现应为推进时间后收到一次旧超时事件。

### 5.2 添加正常计时保护用例

在同一测试文件增加正向用例：

- OCGCore 保持 active 时完成 `TIME_CONFIRM` 重排；
- 推进剩余时间后恰好发布一次 `FINISH_DUEL_BY_TIMEOUT`；
- `originalDuelPos` 和赢家方向保持现有行为。

该用例用于防止生命周期门禁误伤合法超时。

### 5.3 实现最小生命周期门禁

只修改 `src/ygopro/ocgcore-worker/ocgcore.ts`：

1. 在 `setResponseTimer()` 入口检查 OCGCore 是否已经进入 `isDisposing` 或 worker 已为空；失效实例直接返回；
2. `await sendTimeLimitMessage()` 返回后、读取零时间分支或调用 `TimerState.schedule()` 前，再执行一次相同检查；
3. 在 `handleResponseTimeout()` 发布事件前增加相同的 active 检查，并保留现有 `runningPos` 一致性检查；
4. 保持 `disposeWithTimeout()` 先设置 `isDisposing`、再清理 worker 与 timer 的顺序；
5. 更新相关短注释，明确异步响应计时不得在 dispose 后恢复，但不引入新的公共方法或抽象层。

入口检查覆盖“调用开始时已经失效”，异步后的第二次检查覆盖本次事故中“调用开始时有效、await 期间被销毁”的竞态。JavaScript 在第二次检查与同步 `schedule()` 之间不会插入其他任务，因此不需要额外锁。

### 5.4 聚焦验证红转绿

执行：

```bash
npm test -- src/ygopro/ocgcore-worker/ocgcore.test.ts --runInBand
```

验收：

- 新竞态测试修复前失败、修复后通过；
- 正常超时用例通过；
- 既有 Worker dispose、重复 dispose、正常胜负与外部 dispose 测试全部通过；
- 测试不依赖真实 450 秒等待、网络端口或 WASM worker。

## 6. 完整验证

依次执行：

```bash
npm run lint
npm run test
npm run build
npm run check:nostalgia-resources
```

验收标准：

- lint、完整 Jest、TypeScript 构建全部通过；
- 固定资源检查通过且 `nostalgia-resources/lock.json` 无变化；
- Git diff 仅包含 OCGCore 生命周期修复、同目录测试和必要注释；
- 无新增依赖、配置、协议或数据库变更。

## 7. 发布与观察

实现与验证完成后，生产部署需单独确认，并使用项目发布技能执行。部署后：

1. 对 1103、1109 分别运行 `npm run smoke:duel -- <port>`；
2. 确认真实建房、卡组校验、决斗、投降、换备和下一局均正常；
3. 观察 `Response timeout`、`Failed to handle response timeout`、OCGCore dispose error/warn；
4. 若出现合法超时，确认它属于当前 active OCGCore，且不存在“上一局结束时间 + 上一局剩余时间 = 当前误判时间”的跨局特征；
5. 重点观察同包或短间隔 `SURRENDER + TIME_CONFIRM` 场景，确认下一局不会收到旧超时事件。

## 8. 回滚

本修复不含迁移或资源变更，回滚只需恢复 OCGCore 生命周期门禁及对应测试所在提交，并重新发布上一镜像。

若上线后发现正常 timeout 不再触发：

- 立即回滚应用镜像；
- 保留生产日志中的 OCGCore 生命周期与计时证据；
- 不修改数据库、固定资源或房间数据；
- 回到聚焦测试检查 active 判定是否错误覆盖了正常 worker。

## 9. 相关实现位置

- `src/ygopro/ocgcore-worker/ocgcore.ts`：响应计时重排、dispose 状态和超时事件发布；
- `src/ygopro/ocgcore-worker/ocgcore.test.ts`：确定性竞态回归与正常计时保护；
- `src/ygopro/room/domain/states/YGOProDuelingState.ts`：投降、`TIME_CONFIRM` 和房间超时事件监听；本次仅作为行为边界，不计划修改；
- `src/ygopro/room/domain/TimerState.ts`：通用 timer 状态；本次不计划修改。
