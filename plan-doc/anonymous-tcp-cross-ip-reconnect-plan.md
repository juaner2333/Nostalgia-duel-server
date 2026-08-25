# Plan：匿名 TCP 在旧连接确认关闭后限时允许跨 IP 重连

> 状态：待观察，暂不实施
>
> 触发条件：生产日志确认合法玩家的重连失败主要由 `reconnect_judgement.reason=ip_mismatch` 导致
>
> 前置版本：先上线并观察现有 `last join wins`、稳定来源 IP 与 90 秒房间保活实现

## 1. 背景

当前匿名 TCP 按昵称重连要求原、新连接均为 TCP，且来源 IP 完全一致。它已经允许同 IP 的新连接接管仍处于半开状态的旧 socket，并采用 `last join wins`：接管前解除旧 socket 的房间监听器，再销毁旧 socket，最终只有最新连接控制原席位。

该限制可以降低匿名玩家仅凭房间号和昵称接管活跃席位的风险，但运营商 CGNAT、移动网络切换和家庭宽带重新拨号都可能改变服务端看到的出口 IP，导致合法玩家被 `ip_mismatch` 拒绝。

本计划不直接删除 IP 限制，而是将匿名 TCP 重连拆成两种情况：

1. **旧 socket 仍然打开或仅表现为半开**：继续要求来源 IP 一致，才允许 `last join wins` 强制接管；
2. **服务端已经明确处理旧 socket 的关闭事件**：从确认关闭时开始，在固定 90 秒内允许同昵称玩家跨 IP 重连。

## 2. 决策边界

### 2.1 必须保持的行为

- 原、新连接来源 IP 相同时，保留现有匿名 TCP 重连行为，不恢复旧的 `socket.closed === true` 前置要求。
- 旧连接仍打开时，不同 IP 的新连接必须拒绝接管，避免攻击者仅凭房间号和昵称踢掉活跃玩家。
- 只有服务端已经收到并处理旧 socket 的 `close`、`end` 或等价生命周期事件，才视为“明确关闭”；不得依据客户端声明或未经处理的瞬时 `closed` 值放行。
- 旧连接明确关闭后，跨 IP 资格窗口固定为 90 秒，从第一次确认关闭时开始计算；失败的 JOIN、重复关闭事件和重复重连尝试均不得刷新或延长窗口。
- 成功重连后立即清除该席位的跨 IP 资格，继续使用现有同步、确定的 `last join wins` socket 替换流程。
- 强认证玩家继续通过 token 重连；WebSocket、匹配房、AI 房和其他既有特殊路径不进入匿名 TCP 跨 IP 分支。
- 1103 与 1109 使用相同行为，不改变房间身份、卡池、禁限卡表或资源加载。

### 2.2 90 秒窗口的准确含义

当前 `YGOProRoom` 的 90 秒 reconnect grace 是**房间级**计时器，只在已开始的非 AI、非匹配房间没有任何在线玩家时启动，用于延迟终结整个房间。它不能直接证明某一个席位何时断线，也无法覆盖“对手仍在线”的情况。

实现本计划时需要增加独立的**席位级跨 IP 截止时间**：

- 在断线处理器确认某个玩家 socket 已关闭时，以房间内稳定的玩家位置记录 `crossIpReconnectUntil`；
- 房间级 reconnect grace 继续负责全员断线后的房间终结，不改变现有职责；
- 两种计时均使用同一 90 秒常量，避免配置漂移，但不得由 JOIN 尝试重置；
- 房间终结、成功接管或席位生命周期结束时必须清理席位级记录；
- 不长期保存 `Client` 或 `Room` 强引用，记录使用房间内部席位标识或其他轻量状态。

### 2.3 窗口结束后的行为

- 若房间已经因全员断线超过 90 秒而终结，后续 JOIN 按正常流程处理，不得恢复旧房间。
- 若对手仍在线、房间仍存在，但该席位的 90 秒跨 IP 窗口已过：不同 IP 重连必须拒绝；同 IP 重连继续沿用现有准入规则。
- 被拒的连接保持当前阶段既有语义（通常降级为观战者），不得修改房间席位或旧玩家状态。

## 3. 上线前的数据门槛

在修改代码前，先观察一个完整发布周期内的现有结构化日志：

- `reconnect_judgement.result=takeover`：现有同 IP `last join wins` 成功次数；
- `reconnect_judgement.reason=ip_mismatch`：因 IP 不一致被拒次数；
- `reconnect_judgement.reason=player_not_found|transport_mismatch|strong_auth`：排除与 IP 无关的问题；
- `reconnect_grace.event=started|cancelled|expired`：判断全员断线房间是否在窗口内恢复。

只有满足以下证据后才进入实现：

1. 至少有多起能通过时间、环境和外部房间号对应到真实玩家反馈的 `ip_mismatch`；
2. 反馈玩家确认重连前后发生了 CGNAT 出口漂移、宽带重新拨号或 Wi-Fi/移动网络切换；
3. 日志没有显示请求已经成功 `takeover`，从而排除接管后的卡组提交或局面同步问题；
4. 产品方接受“旧连接关闭后的 90 秒内，匿名昵称仍不是强身份凭证”的剩余风险。

## 4. 最小实现方案

### 4.1 领域判定

扩展 `findReconnectingPlayer` 的输入，使其能够获得服务端记录的席位断线状态和跨 IP 截止时间。判定顺序固定为：

1. 原席位和完全相同的昵称存在；
2. 原玩家不是强认证玩家；
3. 原、新传输均为 TCP；
4. 来源 IP 相同：立即允许接管，不读取旧 socket 是否关闭；
5. 来源 IP 不同：只有“旧连接已确认关闭”且当前时间早于席位截止时间时允许接管；
6. 其他情况拒绝，并返回稳定、可统计的拒绝原因。

建议新增的拒绝原因：

- `cross_ip_socket_not_closed`：不同 IP，但旧连接尚未被服务端确认关闭；
- `cross_ip_grace_expired`：旧连接已关闭，但 90 秒窗口已过；
- 保留现有 `ip_mismatch` 作为兼容汇总项，或在日志指标中将上述两个原因归入该类别。

不得把时间读取隐藏在纯领域函数内部；由调用方传入当前时间或明确的资格状态，使测试可确定执行。

### 4.2 生命周期记录

- 在 `YGOProDisconnectHandler` 确认离开者是已开始房间的玩家时，记录该席位首次确认断线的时间和截止时间。
- 重复的 `close`、`end`、`error` 回调必须幂等，不能延长窗口。
- `YGOProRoom.reconnect` 成功后清理旧记录；旧 socket 的监听器仍须在销毁前解除，避免迟到的关闭事件污染新连接状态。
- `FinalizeYGOProRoom` 无条件清理所有席位级跨 IP 状态。

### 4.3 日志

继续使用 `reconnect_judgement`，至少补充以下非敏感字段：

- `previousConnectionState`: `open` 或 `confirmed_closed`；
- `ipRelation`: `same` 或 `different`；
- `policy`: `same_ip_takeover`、`cross_ip_closed_grace` 或对应拒绝策略；
- `graceRemainingMs`：仅输出非负的剩余毫秒数，不输出具体时间戳。

不得记录完整 IP、玩家昵称、重连 token、完整 PlayerInfo/JoinGame 帧或卡组内容。

## 5. 测试优先清单

修改生产代码前先增加失败测试，至少覆盖：

1. 旧 TCP socket 仍打开、同昵称、同 IP：允许接管并关闭旧 socket；
2. 旧 TCP socket 仍打开、同昵称、不同 IP：拒绝接管；
3. 旧 socket 已确认关闭、不同 IP、经过 89,999ms：允许接管；
4. 旧 socket 已确认关闭、不同 IP、达到或超过 90,000ms：拒绝接管；
5. 重复关闭事件、失败 JOIN 和恶意重复尝试不延长 90 秒窗口；
6. 成功跨 IP 接管清除席位记录，迟到的旧连接关闭回调不影响新 socket；
7. 原、新任一端为 WebSocket 时不进入匿名 TCP 跨 IP 路径；
8. 强认证玩家不能通过昵称或跨 IP 窗口接管，仍使用 token；
9. 全员断线时，房间级 90 秒终结计时与席位级窗口一致工作，终结后不能恢复；
10. 对手仍在线时，只有断线席位获得独立的 90 秒跨 IP 资格；
11. 1103、1109 的真实 loopback TCP 生命周期测试均覆盖成功接管、拒绝和最终 socket 所有权；
12. 各决斗阶段（猜拳、选先后手、决斗中、换备）保持既有重同步消息和 `last join wins` 行为。

## 6. 安全风险与缓解

即使旧 socket 已关闭，跨 IP 匿名重连仍然只依赖房间号和昵称，不是强认证。攻击者若知道玩家断线时机，仍可能在 90 秒内抢占席位。

本计划通过以下措施限制风险：

- 不允许不同 IP 接管仍打开或半开的活跃连接；
- 跨 IP 窗口只由服务端确认关闭事件创建；
- 窗口固定且不可续期；
- 保留结构化审计日志，能够统计跨 IP 成功与拒绝；
- 若出现抢占反馈，立即关闭跨 IP 分支并回退到现有同 IP 策略。

长期更安全的方向是让匿名 TCP 客户端携带稳定重连凭证，例如兼容的 reconnect token 或隐藏 vpass。在客户端协议能够支持前，不把昵称本身视为可靠身份。

## 7. 验证与发布

实现后依次执行：

```bash
npm run lint
npm run test
npm run check:nostalgia-resources
npm run build
```

涉及真实服务器入口和房间生命周期时，再对临时 loopback 端口运行双环境 TCP 冒烟。生产发布采用小流量观察：

- 统计 `same_ip_takeover` 与 `cross_ip_closed_grace` 成功数；
- 统计 `cross_ip_socket_not_closed` 与 `cross_ip_grace_expired` 拒绝数；
- 关联用户反馈确认跨 IP 成功后能完成卡组提交与局面同步；
- 观察是否出现异常连续接管、同一房间短时间多次换 socket 或玩家被抢占反馈。

## 8. 回滚

回滚时只关闭“确认关闭后的跨 IP 资格”分支：

- 恢复所有匿名 TCP 重连必须同 IP；
- 保留现有 `last join wins`、稳定来源 IP、90 秒房间级保活和结构化日志；
- 清理席位级跨 IP 状态，不影响房间、资源或持久化数据；
- 不需要数据库迁移或固定资源回滚。

## 9. 相关实现位置

- `src/shared/room/domain/findReconnectingPlayer.ts`：匿名按名称重连资格判定与结构化日志；
- `src/ygopro/room/domain/YGOProRoom.ts`：同步 socket 替换、`last join wins` 与房间级 reconnect grace；
- `src/ygopro/room/application/YGOProDisconnectHandler.ts`：服务端确认旧连接关闭的生命周期入口；
- `src/ygopro/room/application/FinalizeYGOProRoom.ts`：统一房间终结与状态清理；
- `src/ygopro/room/domain/states/`：猜拳、选先后手、决斗中和换备阶段的 JOIN 重连处理；
- `src/socket-server/YGOProRoomLifecycle.test.ts`：1103/1109 真实 TCP 生命周期回归。
