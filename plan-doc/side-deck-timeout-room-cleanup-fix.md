# YGOPro 换备超时房间未回收修复计划

> 状态：待实施
>
> 事故样本：生产环境 `1103#888`，内部房间 `6531`，2026-08-28

## 1. 摘要

修复 MATCH 对局进入换备阶段后，玩家超过 `SIDE_TIMEOUT_MINUTES` 未提交卡组时仅销毁玩家 socket、却没有执行统一房间终结流程，导致房间永久残留在 `sideDecking` 的问题。

本计划采用最小生命周期修复：

- 将换备超时定义为当前房间的终止条件；
- 超时时调用现有 `FinalizeYGOProRoom.run(room)`，统一清理状态定时器、连接、重连令牌、房间列表与实时广播；
- 不修改 `ISocket.destroy()`、TCP/WebSocket 适配器的全局语义；
- 不新增依赖、协议、数据库或固定资源变更；
- 不在本修复中新增超时判负或比赛结果持久化语义。

## 2. 已确认的生产证据

北京时间 2026-08-28，`1103#888` 的相关事件如下：

| 时间 | 事件 |
| --- | --- |
| 14:49:34 | 第二局结束，比分变为 1:1，房间进入 `sideDecking` |
| 14:52:34 | `KC` 与 `初哥` 均记录 `Side deck timeout` |
| 15:51:58 | `/api/rooms` 仍返回内部房间 `6531`，状态为 `sideDecking` |

同期容器无重启、无 OOM、无 Worker 异常。该残留是房间生命周期未闭合，不是进程或 OCGCore 故障。

## 3. 根因

当前换备超时路径为：

1. `YGOProSideDeckingState.tickPlayerTimeout()` 记录超时并发送提示；
2. 调用 `player.destroy()`；
3. `YGOProClient.destroy()` 转调当前 socket 的 `destroy()`；
4. TCP 与 WebSocket socket 适配器的 `destroy()` 都会先执行 `removeAllListeners()`；
5. 服务端注册的 close callback 被移除，`YGOProDisconnectHandler` 不会运行；
6. 因此不会启动 reconnect grace，也不会调用 `FinalizeYGOProRoom`；
7. 换备状态的 interval、玩家席位和房间列表记录持续存活。

单纯修改底层 `destroy()` 让 close callback 重新触发，会影响重连替换、拒绝连接、正常终局和主动 teardown 等多个调用方，超出本问题的必要范围。

## 4. 行为决策

### 4.1 目标行为

- 任意已入座玩家在换备阶段耗尽提交时限时，当前房间立即终止；
- 所有玩家和观战者连接关闭；
- 换备 interval 全部取消；
- 重连令牌撤销；
- 房间从 `YGOProRoomList` 删除；
- 实时房间列表恰好广播一次 `REMOVE-ROOM`；
- 相邻或重复超时回调保持幂等，不产生重复清理或异常。

### 4.2 保持不变

- 保持 `SIDE_TIMEOUT_MINUTES` 当前配置与倒计时提示；
- 保持普通网络断线的 90 秒 reconnect grace；
- 保持 `ISocket.close()`、`destroy()` 和 `removeAllListeners()` 语义；
- 保持 1103/1109 的 MATCH、卡池、禁限卡表和脚本行为；
- 不把换备超时自动记为对手胜利，不发布新的 `GameOverDomainEvent`；
- 不修改已完成局的比分或统计数据。

若产品需要“换备超时判负并持久化完整比赛结果”，应作为独立需求确认胜负类型、录像和统计口径后再实现，不与本次资源回收修复捆绑。

## 5. 执行步骤（测试优先）

### 5.1 添加失败的回归测试

在 `src/ygopro/room/domain/states/YGOProSideDeckingState.test.ts` 增加换备超时生命周期用例：

1. 使用 Jest fake timers；
2. 创建包含两名已入座玩家的真实 `YGOProRoom`，并加入 `YGOProRoomList`；
3. 构造 `YGOProSideDeckingState`，将其注册为房间当前状态；
4. 推进 `SIDE_TIMEOUT_MINUTES` 对应时间；
5. 在修改生产代码前确认测试失败，失败表现为房间仍存在；
6. 断言修复后：
   - `YGOProRoomList.findById(room.id)` 返回 `null`；
   - 两个玩家 socket 均关闭；
   - `jest.getTimerCount()` 为 0；
   - `REMOVE-ROOM` 只广播一次；
   - 房间 `finalizing` 为 `true`。

再增加一个保护用例：玩家在时限内成功提交换备卡组时，仅清除该玩家的 timer，不终止房间，并保持现有选先后手流程。

### 5.2 实现最小修复

只修改 `src/ygopro/room/domain/states/YGOProSideDeckingState.ts`：

1. 在超时分支保留当前日志与客户端提示；
2. 将 `player.destroy()` 替换为 `FinalizeYGOProRoom.run(this.room)`；
3. 依赖统一终结流程调用 `room.disposeRoomState()`，清除全部换备 timer；
4. 不额外调用单个 socket 的 `destroy()`，避免重复且不完整的清理；
5. 不引入新的服务、事件、配置或抽象。

预期核心变更：

```ts
if (remain <= 1) {
	this.clearPlayerTimeout(player.position);
	this.logger.info("Side deck timeout", { player: player.name, position: player.position });

	this.broadcastChat(
		`${player.name} has been disconnected for not submitting a side deck in time.`,
		ChatColor.BABYBLUE,
	);
	this.sendChatToPlayer(player, "Time is up! You have been disconnected.", ChatColor.RED);
	FinalizeYGOProRoom.run(this.room);
	return;
}
```

`FinalizeYGOProRoom.run()` 已具备幂等门禁；即使两个 timer 在相邻事件循环中触发，也不得产生重复删除或重复广播。

### 5.3 聚焦验证

执行：

```bash
npm test -- src/ygopro/room/domain/states/YGOProSideDeckingState.test.ts --runInBand
npm test -- src/ygopro/room/application/YGOProDisconnectHandlerReconnectGrace.test.ts --runInBand
npm test -- src/socket-server/YGOProRoomLifecycle.test.ts --runInBand
```

验收：

- 新增超时测试红转绿；
- 普通断线仍进入 90 秒 grace；
- 成功重连仍可继续换备；
- 第一局结束仍正常进入换备，而不是提前删除房间；
- 正常提交双方换备后仍进入下一局选先后手。

## 6. 完整验证

按项目要求执行：

```bash
npm run lint
npm run test
npm run build
npm run check:nostalgia-resources
```

验收标准：

- lint、完整 Jest、TypeScript 构建和固定资源校验全部通过；
- `nostalgia-resources/lock.json` 无变化；
- Git diff 仅包含换备超时终结逻辑、同目录测试和必要注释；
- 无新增依赖、数据库迁移、协议或固定资源变更。

## 7. 发布与观察

生产部署需单独确认，并使用项目发布流程执行。部署后：

1. 对 1103、1109 分别完成真实双人 MATCH 冒烟；
2. 验证第一局结束进入换备、双方正常提交后进入下一局；
3. 使用受控测试房间让一方换备超时，确认超时后 `/api/rooms` 不再返回该房间；
4. 检查同一房间只有一次 `Side deck timeout` 终结和一次 `REMOVE-ROOM`；
5. 观察是否新增 teardown、socket dispose 或 timer 相关错误。

## 8. 回滚

本修复不含迁移或资源变更。若上线后发现正常换备被错误终止：

- 回滚应用镜像至上一版本；
- 保留超时日志、房间状态和 `REMOVE-ROOM` 证据；
- 不修改数据库或固定资源；
- 回到聚焦测试检查 timer 清除和提交成功分支是否发生竞态。

## 9. 相关实现位置

- `src/ygopro/room/domain/states/YGOProSideDeckingState.ts`：换备计时、提交与超时入口；
- `src/ygopro/room/domain/states/YGOProSideDeckingState.test.ts`：本次新增回归测试；
- `src/ygopro/room/application/FinalizeYGOProRoom.ts`：统一房间终结与幂等清理；
- `src/ygopro/room/application/YGOProDisconnectHandler.ts`：真实 socket close 的普通断线和 grace 行为，本次不修改；
- `src/shared/socket/domain/TCPClientSocket.ts`：TCP 强制销毁语义，本次不修改；
- `src/shared/socket/domain/WebSocketClientSocket.ts`：WebSocket 强制销毁语义，本次不修改。
