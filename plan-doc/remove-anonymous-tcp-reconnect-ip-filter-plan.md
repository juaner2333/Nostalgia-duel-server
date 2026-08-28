# Plan：移除匿名 TCP 按昵称重连的来源 IP 限制

> 状态：已确认，待实施
>
> 决策：重连优先；同昵称匿名 TCP 新连接无条件采用 `last join wins`，允许跨 IP 接管仍打开、半开或已关闭的旧连接
>
> 取代方案：`anonymous-tcp-cross-ip-reconnect-plan.md` 中“仅确认断线后 90 秒内允许跨 IP”的折中方案不再实施

## 1. 背景与根因

已开始的非排位房间通过 `findReconnectingPlayer` 处理匿名客户端按昵称重连。当前资格判定要求：

1. 房间中存在完全同名的玩家席位；
2. 玩家不是强认证玩家；
3. 原连接和新连接均为 TCP；
4. 新连接来源 IP 与玩家缓存的来源 IP 相同。

第 4 项会在移动网络切换、运营商出口变化或宽带重新拨号后返回 `ip_mismatch`。各房间阶段随后把新连接降级为观战者，导致合法玩家无法恢复原席位。

本次只移除来源 IP 这一项限制。昵称、强认证、传输类型、房间身份和协议校验继续生效。

## 2. 目标行为

- 非排位房中的匿名 TCP 玩家以相同昵称重新加入时，不比较来源 IP。
- 不论旧 socket 已关闭、仍打开或处于半开状态，新连接都可接管原席位。
- 接管继续使用现有同步流程：解除旧 socket 的房间监听器、销毁旧 socket、绑定新 socket，并由最新连接控制席位。
- 成功接管取消待执行的房间级 reconnect grace 回收计时。
- 猜拳、选择先后手、决斗中和换备阶段继续发送各自既有的重同步消息。
- 被接管玩家的名称、位置、队伍、主客身份、卡组和对局状态保持不变；不得创建额外玩家或观战者。

## 3. 保持不变的安全边界

- 强认证玩家仍不能通过昵称路径接管，必须使用单次 token 重连。
- 非排位房按昵称接管仍限定为 TCP → TCP；任一端为 WebSocket 时返回 `transport_mismatch`。
- 昵称不匹配继续返回 `player_not_found`，不得占用其他玩家席位。
- token 重连、排位身份重连、首次加入、观战准入和固定格式房间路由不变。
- `YgoClient.ipAddress` 继续采集并在 socket 替换时更新，因为它仍用于对局统计；不得因取消重连校验而删除。
- 不修改协议帧、数据库模式、配置项、固定资源或 1103/1109 环境定义。

已接受的风险：知道准确房间号和玩家昵称的匿名 TCP 客户端，可以从不同 IP 接管该玩家仍活跃的席位。这是“重连优先”决策下的明确权衡。

## 4. 最小实现方案

### 4.1 领域判定

修改 `src/shared/room/domain/findReconnectingPlayer.ts`：

- 从输入参数中删除 `remoteAddress`；
- 删除缓存 IP 与新 socket 来源 IP 的比较；
- 从 `ReconnectRejectionReason` 删除 `ip_mismatch`；
- 更新注释，使判定顺序明确为：同名席位存在 → 非强认证 → 非排位房要求 TCP → 允许接管；
- 保留当前 discriminated union 返回结构和结构化判定日志。

### 4.2 各阶段调用方

在以下四个状态的 JOIN 重连处理里移除 `remoteAddress` 传参，不改动其余接管和重同步逻辑：

- `YGOProRockPaperScissorState`；
- `YGOProChoosingOrderState`；
- `YGOProDuelingState`；
- `YGOProSideDeckingState`。

`YGOProRoom.reconnect` 已实现需要的 `last join wins` 行为，本次不重构：它会在销毁旧 socket 前移除监听器，避免迟到的关闭事件清理新连接，并将玩家绑定到新 socket。

### 4.3 日志与兼容

- 成功跨 IP 接管继续记录 `reconnect_judgement.result=takeover`。
- 删除已不可达的 `ip_mismatch` 类型和测试期望，不保留无效兼容分支。
- 其他拒绝原因 `player_not_found`、`strong_auth`、`transport_mismatch` 保持不变。
- 不记录原始 IP、token、完整协议帧或卡组内容。

## 5. 测试优先实施顺序

1. 先把现有“不同 IP 降级为观战者”测试改为“不同 IP 接管原席位”，在未修改生产代码时确认失败。
2. 修改领域判定及四个调用方，用最少代码使聚焦测试通过。
3. 运行完整回归，确认未破坏 token 重连、强认证和房间生命周期。

测试覆盖如下：

- `findReconnectingPlayer`：
  - 非排位匿名 TCP 玩家允许接管；
  - 旧 socket 打开或关闭均不影响接管；
  - 强认证玩家仍返回 `strong_auth`；
  - 原连接或新连接为 WebSocket 时仍返回 `transport_mismatch`；
  - 无同名席位时仍返回 `player_not_found`。
- 四个房间阶段：使用与旧连接不同的 `remoteAddress` 发起同名 TCP JOIN，断言旧 socket 被销毁、新 socket 绑定原玩家、玩家数不变且没有新增观战者；同时保留各阶段重同步消息断言。
- 结构化日志：跨 IP 接管记录 `takeover`；拒绝日志改用 WebSocket 或未知昵称场景验证稳定原因及敏感字段约束。
- 真实 TCP 生命周期：在 `1103#1001` 和 `1109#1001` 中从 `127.0.0.2` 发起跨 IP JOIN，断言原连接关闭、席位身份不变、新连接取得控制权。
- 现有同 IP、token、90 秒房间保活、换备和完整决斗测试继续通过。

## 6. 验收标准

- 匿名 TCP 玩家切换来源 IP 后，可以在所有已开始阶段恢复原席位。
- 跨 IP 重连不再产生 `ip_mismatch`，也不再被降级为观战者。
- 接管后仅新 socket 能驱动该席位，旧 socket 的迟到事件不会影响房间。
- 强认证玩家和 WebSocket 客户端不能绕过各自的 token 重连路径。
- 1103 与 1109 行为一致，无房间身份、资源或持久化回归。

## 7. 验证命令

按顺序执行：

```bash
npm test -- --runInBand src/shared/room/domain/findReconnectingPlayer.test.ts src/ygopro/room/domain/states/YGOProNameJoinReconnect.test.ts
npm test -- --runInBand src/socket-server/YGOProRoomLifecycle.test.ts
npm run lint
npm run test
npm run check:nostalgia-resources
npm run build
```

本地服务可启动时，再对临时 loopback 端口执行双环境 `npm run smoke:duel -- <port>`。

## 8. 回滚

如出现匿名席位被冒名接管的问题，回滚本次领域判定和调用方改动即可恢复同 IP 限制。回滚不涉及数据库迁移、固定资源或协议兼容处理。
