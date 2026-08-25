## Why

匿名普通 TCP 玩家在移动端切后台或短暂弱网后，旧连接可能仍处于半开状态，现有 casual 重连要求旧 socket 已关闭，导致同一公网出口下的合法玩家被降级为观战者。双方同时断线时房间还会立即销毁，使后续重连失去目标，需要明确一套兼顾同 IP 身份约束与半开连接接管的匿名 TCP 重连契约。

## What Changes

- 将已开局匿名普通 TCP 房间的按名称重连条件调整为“相同 `format#roomId` + 完全相同昵称 + 与原玩家相同的来源 IP + 原玩家席位仍存在”，不再要求旧 socket 已关闭。
- 采用 `last join wins`：新连接原子接管原玩家席位，旧 socket 先解除房间生命周期监听，再被主动销毁，避免旧连接继续输入或误触发房间清理。
- 对双方都失联的非 AI、非匹配中对局增加默认 90 秒重连宽限期；任一原玩家成功重连即取消待清理，超时后沿用现有统一房间终结流程。
- 保持等待阶段离房、匹配房间中止、WindBot/AI 房间销毁、WebSocket token 重连、强认证玩家保护、观战和 1103/1109 组合房间身份不变。
- 增加不含 token 和完整协议载荷的结构化重连判定日志，能够区分接管成功、未找到原玩家、房间处于宽限期和宽限期超时。
- 用测试侧 TCP socket 覆盖同 IP 半开旧连接接管、不同 IP 拒绝接管、旧 socket 关闭后的接管、双方断线宽限、超时清理、并发同名重连和各对局阶段同步。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ygopro-only-server`: 明确匿名普通 TCP 玩家在已开局房间中的按名称席位接管、旧连接处置以及双方断线后的有限重连宽限行为。

## Impact

- 主要影响 `src/shared/room/domain/findReconnectingPlayer.ts`、`src/ygopro/room/domain/YGOProRoom.ts`、`src/ygopro/room/application/YGOProDisconnectHandler.ts`、统一房间终结流程及其就近测试。
- 不新增第三方依赖、数据库字段、迁移、端口、环境路由或线协议命令。
- 匿名 TCP 不具备独立身份凭证；本变更保留原玩家 IP 校验以拒绝跨公网出口抢占，但同一 NAT 出口下知道房间号和准确昵称的人仍可能抢占玩家席位，这是提高半开连接重连可用性所接受的剩余风险。
- 生产日志与运维需要能够保留重连判定事件；现有 DEBUG 全帧日志的轮转策略应单独调整，但不属于本变更的运行时协议范围。
