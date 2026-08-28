# Plan：在 0x1362 服务端中兼容 0x1361 实时对局协议

> 状态：待评审（确认范围后按测试优先实施）
>
> 默认方案：0x1361 直接准入；服务端内部与录像继续使用 0x1362；仅对发送给 0x1361 客户端的实时 `STOC_GAME_MSG` 做逐客户端降级
>
> 取代关系：本计划获批并实施后，取代 [0x1361-client-compat-plan.md](./0x1361-client-compat-plan.md) 中“拒绝所有非 0x1362 客户端”的产品决策；旧文档保留为历史记录

## 1. 背景与现状

当前服务以 `0x1362` 为唯一 YGOPro 协议版本：

- `src/ygopro/ygopro/protocol-version.ts` 只导出 `YGOPRO_PROTOCOL_VERSION = 0x1362`；
- `src/ygopro/room/application/YGOProJoinHandler.ts` 在解析房间标识、查找/创建房间和重连之前拒绝所有非 `0x1362` 连接；
- TCP、WebSocket 和多阶段重连测试均把 `0x1361` 锁定为拒绝行为；
- README、OpenSpec、CHANGELOG 和根 `AGENTS.md` 明确记录“不做任何版本兼容”。

参考目录 `/personal-vscode-project/srvpro-master` 已实现 `0x1361` 兼容，但它不只是放宽加入版本：

1. 在 `JOIN_GAME` 时保存客户端真实版本；
2. 服务端核心继续按当前版本工作；
3. 每次向客户端发送 `STOC_GAME_MSG` 时，根据该客户端版本转换消息体；
4. `0x1361` 没有额外的 `CTOS_RESPONSE` 转换实现，客户端响应仍按原始索引/数量交给核心。

因此，本项目不能只把版本判断改为 `0x1361 || 0x1362`。如果不做消息转换，旧客户端会在特定决斗消息上错位解析、错误响应或卡死。

## 2. 已确认的协议差异

`0x1361 → 0x1362` 至少包含以下三项实时决斗消息变化：

| 消息 | 0x1362 格式 | 发给 0x1361 时的转换 |
|---|---|---|
| `MSG_CONFIRM_CARDS (0x1f)` | `player` 后新增 `skip_panel` | 删除 `skip_panel`，后续 `count/cards` 左移一字节 |
| `MSG_SELECT_CHAIN (0x10)` | 删除头部全局 `forced`，每个 14 字节候选项增加自己的 `forced` | 计算所有候选项是否存在 `forced != 0`，在头部恢复一个全局标志，并删除每项的 `forced`；候选顺序不变 |
| `MSG_SELECT_SUM (0x17)` | `sum_param` 支持最高位标记的 31 位单值 | 若任一卡片使用扩展单值，则将目标值及全部候选值按共同 GCD 等比例缩放，编码为旧客户端可解释的两个 16 位操作数 |

上游依据：

- Core `48698bf` / Client `f4db575`：`MSG_CONFIRM_CARDS` 增加 `skip_panel`；
- Core `7c5796a` / Client `e7ebb75`：`MSG_SELECT_CHAIN` 从全局强制标记改为逐候选项标记；
- Core `cbb1053` / Client `db1633b`：`MSG_SELECT_SUM` 扩展 `sum_param` 解释规则；
- srvpro 参考实现：`msg-polyfill/polyfillers/0x1361.ts`。

`SELECT_CHAIN` 和 `SELECT_SUM` 的响应仍是候选索引集合：转换不改变候选顺序，`SELECT_SUM` 的等比例缩放只用于旧客户端展示和本地可选性判断，服务端核心仍用原始 0x1362 数值验证相同索引。

## 3. 目标、非目标与成功标准

### 3.1 目标

- 仅支持 `0x1361`、`0x1362` 两个明确版本，不使用版本范围或环境变量动态放行；
- TCP 与 WebSocket 的 `0x1361` 客户端可以直接进入现有 `1103#<roomId>`、`1109#<roomId>` 房间；
- 同一房间允许 `0x1361`、`0x1362` 玩家和观战者混合存在，每个客户端收到适合自身版本的帧；
- OCGCore、房间状态、卡池、禁限卡表、脚本、对局记录和持久化事件继续以 `0x1362` 为唯一内部事实；
- 等待、RPS、先后手选择、决斗、换备阶段的准入、观战和既有重连行为保持不变；
- 未支持版本继续在任何房间副作用之前收到版本错误帧与升级提示，然后关闭。

### 3.2 非目标

- 不支持 `0x1360`、`0x1363` 或其他版本；
- 不增加 `ALT_VERSIONS`、运行时开关或范围判断；
- 不改动 1103/1109 固定资源、卡池、LFList、Lua、WASM 核心或 `lock.json`；
- 不为协议兼容新增房间类型、平行房间状态机或第二套 OCGCore；
- 不转换 YRP/EVRP 录像内部消息：本阶段生成和下载的录像版本仍为 `0x1362`；
- 不保证 0x1361 客户端能本地打开 0x1362 录像；
- 不照搬 srvpro 的“第一次拒绝、第二次连接才启用兼容”流程，默认直接准入。

### 3.3 可验证的成功标准

- `0x1361`、`0x1362` 均可通过 TCP 和 WebSocket 加入两个固定环境；
- `0x1360`、`0x1363` 仍在策略解析和房间操作前拒绝；
- 三类兼容消息逐字节匹配人工审核的 0x1361 固定样本，帧长度前缀正确；
- 转换不修改共享的原始 Buffer；同一标准帧发给混合版本客户端时互不污染；
- 0x1362 客户端收到的所有帧与改动前逐字节一致；
- 0x1361 玩家、观战者和重连玩家均经过相同转换边界；
- 客户端响应按原始索引正确进入 OCGCore，不产生额外 `MSG_RETRY`；
- 两个固定环境的真实 WASM 决斗、观战、投降和 `MATCH_END` 冒烟继续通过；
- `npm run lint`、`npm run test`、`npm run check:nostalgia-resources`、`npm run build` 全部通过。

## 4. 设计方案

### 4.1 版本模型

修改 `src/ygopro/ygopro/protocol-version.ts`，保持内部主版本的单一事实来源，并新增显式支持集合与类型守卫：

```ts
export const YGOPRO_PROTOCOL_VERSION = 0x1362;
export const YGOPRO_COMPATIBLE_PROTOCOL_VERSION = 0x1361;
export type SupportedYGOProProtocolVersion = 0x1361 | 0x1362;
export const isSupportedYGOProProtocolVersion = (version: number): version is SupportedYGOProProtocolVersion => ...;
```

约束：

- WindBot、录像头和服务端配置继续引用 `YGOPRO_PROTOCOL_VERSION`；
- 只有加入准入和客户端出站转换使用支持集合；
- 不把最低版本推导为 `>= 0x1361`，避免将未知新版本误判为兼容。

### 4.2 显式传递客户端真实版本

客户端版本来自已解析的 `YGOProCtosJoinGame.version`，沿现有加入链显式传递：

```text
YGOProJoinHandler
  → JoinContext.protocolVersion
  → room.emit("JOIN", message, socket, protocolVersion)
  → 各 YGOProRoomState.handleJoin
  → YGOProRoom 创建/重连客户端
  → YGOProClient.protocolVersion
```

具体要求：

- `JoinContext` 增加必填 `protocolVersion`；
- Nostalgia、WindBot、AI token 等现有策略转发该字段，不自行推断版本；
- 初次玩家/观战者创建时写入版本；
- 名字重连使用新 `JOIN_GAME` 中的版本，并在发送第一条重连同步消息前更新客户端版本；
- Express Token 重连没有新的 `JOIN_GAME` 版本字段，沿用座位上已有的版本；
- 内部 WindBot 默认且继续使用 `0x1362`；
- 不向 `src/shared/ISocket` 添加 YGOPro 专用字段，保持共享层不依赖客户端协议。

需要覆盖所有监听 `JOIN` 的状态：

- `YGOProWaitingState`；
- `YGOProRockPaperScissorState`；
- `YGOProChoosingOrderState`；
- `YGOProDuelingState`；
- `YGOProSideDeckingState`。

### 4.3 纯函数出站转换器

在 `src/ygopro/client/domain/` 就近新增 `YGOProProtocolCompatibility.ts` 与同目录测试，职责限定为：

```ts
adaptServerFrameForProtocol(
  frame: Buffer,
  protocolVersion: SupportedYGOProProtocolVersion,
): Buffer
```

行为：

1. `0x1362` 直接返回原帧，不重新编码；
2. 非 `STOC_GAME_MSG (0x01)` 直接返回原帧；
3. `0x1361` 的三个已知消息按第 2 节转换；
4. 其他 `GAME_MSG` 保持字节不变；
5. 结构发生变化时重新生成二字节小端长度前缀，长度仍包含命令字节；
6. 转换前校验固定头和由计数字段推导出的最小长度，禁止越界读取；
7. 任何转换都不原地修改输入 Buffer，防止广播给下一个客户端时串版本；
8. 不通过 `ygopro-msg-encode` 重新解码旧格式，因为当前依赖只描述 0x1362 消息布局。

转换算法保持最小：不引入新依赖、不建立通用插件注册表、不为尚未支持的版本预建抽象。

### 4.4 唯一发送边界

在 `YGOProClient.sendMessageToClient` 调用纯函数转换器后再写 Socket：

```text
房间/OCGCore 生成标准 0x1362 帧
                │
                ▼
YGOProClient.sendMessageToClient
       ├─ 0x1362 → 原帧
       └─ 0x1361 → 必要时转换
                │
                ▼
          TCP / WebSocket
```

选择该边界的原因：

- 当前 OCGCore 的常规路由、观战视图、重连补发和历史消息最终都调用该方法；
- 无需在 `OCGCore.deliverToTargets`、每个房间状态和每种消息发送点重复判断版本；
- 房间广播可继续复用一个标准 Buffer；客户端转换器复制后发送，不污染其他客户端；
- 领域记录和录像不会被降级后的临时线协议内容污染。

禁止在 `YGOProMessageRepository` 全局转换，因为同一条房间消息可能同时发送给两个版本的客户端。

### 4.5 加入与提示行为

调整 `YGOProJoinHandler`：

- `isSupportedYGOProProtocolVersion(version) === false`：保持现有 `VersionError → 升级提示 → close()`；
- `0x1362`：行为完全不变；
- `0x1361`：直接进入策略链，不先拒绝、不要求重新连接。

建议在 0x1361 客户端成功收到 `STOC_JOIN_GAME` 后追加一条蓝色系统聊天：

```text
已启用 0x1361 实时对局兼容模式；录像仍使用 0x1362 格式，建议升级客户端。
```

提示必须在加入成功之后发送，且每次连接最多一次。若评审决定保持协议完全静默，可删除该提示，不影响核心转换设计。

### 4.6 入站响应

本阶段不转换 `CTOS_RESPONSE`：

- `MSG_CONFIRM_CARDS` 不要求客户端响应；
- `MSG_SELECT_CHAIN` 的响应是候选索引，转换保持候选顺序；
- `MSG_SELECT_SUM` 的响应是选择数量及候选索引，GCD 缩放不改变索引；
- OCGCore 仍使用未缩放的标准消息状态验证响应。

测试必须锁定这个假设。如果真实 0x1361 客户端出现响应字节差异，再以捕获的固定样本追加独立入站转换，不能凭猜测实现。

### 4.7 录像边界

`DuelRecord`、YRP、EVRP 保持 `0x1362`：

- 实时历史场面补发通过 `YGOProClient.sendMessageToClient`，因此会按重连客户端版本转换；
- 完整录像包含标准消息及 0x1362 版本头，不对其内部逐帧转换；
- HTTP/持久化元数据、禁限卡表名称与哈希不受影响。

如果以后要求 0x1361 本地回放，需要独立设计录像头、嵌入消息、压缩/校验及双版本回放测试，不并入本次实时兼容。

## 5. 测试优先实施顺序

严格按 SOP-002 执行：先提交能在当前代码上失败的测试，再写最少生产代码。

### 5.1 第一批：转换器固定样本

新增 `src/ygopro/client/domain/YGOProProtocolCompatibility.test.ts`，所有输入和期望均为人工审核、提交到仓库的固定十六进制，不使用被测转换器或同一编码器动态构造期望：

- `CONFIRM_CARDS`：删除 `skip_panel=0`、`skip_panel=1`，验证帧长度减 1；
- `SELECT_CHAIN`：0 个候选、单候选、多候选、无 forced、一个 forced、多个 forced；
- `SELECT_SUM`：无扩展值时逐字节不变；含一个/多个最高位扩展值时验证目标和操作数缩放；
- 非 `GAME_MSG`、未知 `GAME_MSG`、0x1362 均保持不变；
- 输入 Buffer 在转换后逐字节不变；
- 同一输入先发给 1361、再发给 1362，标准帧不受前一次发送影响；
- 截断或计数字段越界样本不会触发越界读写或生成伪合法帧。

先运行该测试，确认因转换器不存在或返回未转换帧而失败。

### 5.2 第二批：版本准入与客户端边界

修改/新增：

- `YGOProJoinHandlerStrategy.test.ts`：1361 可进入策略，1360/1363 仍在策略前拒绝；
- `YGOProClient.test.ts`：保存版本、1361 出站转换、1362 透传、换 Socket 后版本行为；
- `YGOProWaitingState.test.ts`：新玩家和观战者获得握手中的真实版本；
- `YGOProNameJoinReconnect.test.ts`：各阶段名字重连在第一条同步帧前更新版本；
- 对 Express Token 重连增加“保留原版本”断言。

### 5.3 第三批：真实传输契约

更新现有固定拒绝测试，不简单删除安全断言：

- `YGOProServer.test.ts`：TCP 1361 成功加入 1103/1109，1360/1363 仍收到错误与提示；
- `WSYGOProVersionContract.test.ts`：WebSocket 1361/1362 均可加入，未支持版本仍关闭；
- `YGOProRoomLifecycle.test.ts`：将“1361 不得接管座位”改为“未支持版本不得接管”，并新增 1361 在等待、决斗、换备阶段的合法重连；
- 混合版本房间：1361 玩家、1362 玩家和观战者同时存在时，各自收到正确帧，席位与观战计数不变。

### 5.4 第四批：真实核心与客户端验证

- 保留现有 0x1362 双环境 `npm run smoke:duel` 作为零回归基线；
- 为冒烟脚本增加测试侧的显式 1361 运行模式，至少完成两个环境的建房、入房、卡组、READY、RPS、`MSG_START`、观战、投降和 `MATCH_END`；
- 转换器固定样本负责覆盖三个差异消息，因为通用冒烟不保证自然触发它们；
- 使用一份已知版本为 0x1361 的真实客户端分别实测 TCP/WebSocket、玩家/观战、断线重连；
- 真实客户端实测记录构建来源和协议版本，不把单一客户端结果泛化为所有历史构建。

## 6. 文档与行为契约更新

代码通过聚焦测试后，同一变更中更新：

- `AGENTS.md`：主协议仍为 0x1362，但明确允许 0x1361 实时兼容及逐客户端转换边界；
- `README.md`：改为支持 0x1361/0x1362 实时连接，说明录像仍为 0x1362；
- `openspec/specs/ygopro-only-server/spec.md`：加入序列允许两个明确版本，并增加三类转换和混合版本场景；
- `CHANGELOG.md`：记录 0x1361 实时对局兼容；
- `plan-doc/0x1361-client-compat-plan.md`：仅将状态标记为被本计划取代，不删除历史分析；
- 固定协议样本说明：记录每个样本的人工推导字段与预期结果。

归档 OpenSpec 不回写；只更新当前有效规格并通过新的变更记录说明行为演进。

## 7. 许可证与来源边界

`srvpro-master` 的实现采用 AGPL-3.0，而当前项目声明为 MIT。实施时：

- 不复制 srvpro 的 TypeScript/JavaScript 源码、注释、类结构或注册表；
- 以公开的 YGOPro/ocgcore 协议变更、字段布局和可观察输入输出为依据独立实现；
- 固定测试样本由字段规格人工构造，不从 srvpro 测试或运行输出直接复制；
- 在设计文档中保留上游提交链接作为协议事实来源；
- 若项目决定直接采用 AGPL 代码，必须先单独完成许可证评审，不属于本计划默认路径。

## 8. 风险与回滚

### 8.1 主要风险

- `SELECT_CHAIN` 从逐项 forced 降级为全局 forced 会丢失“具体哪一项强制”的信息，这是 0x1361 协议能力限制；
- `SELECT_SUM` GCD 缩放依赖固定卡池脚本产生可等比例表达的数值，需要固定样本与真实客户端共同验证；
- 0x1361 历史构建可能还存在未被 srvpro 覆盖的差异，不能把三个已知转换宣称为所有旧客户端的完全兼容；
- 转换放在共享广播 Buffer 上会污染 0x1362 客户端，因此必须保持纯函数复制语义；
- 重连若在第一条同步消息后才更新版本，会立即发送错误布局，必须锁定调用顺序；
- 录像保持 0x1362 可能让旧客户端无法本地打开，需要在提示与文档中明确。

### 8.2 回滚方式

兼容逻辑不修改数据库和固定资源，可通过单次代码回滚恢复“只接受 0x1362”：

1. 支持集合恢复为仅 0x1362；
2. 移除客户端版本字段及发送转换；
3. 恢复原版本拒绝契约测试和文档。

回滚不得只关闭转换却继续接受 0x1361，否则会重新产生决斗中错位解析。

## 9. 完整验证清单

实施完成前依次运行：

```bash
npm test -- src/ygopro/client/domain/YGOProProtocolCompatibility.test.ts
npm test -- src/ygopro/client/domain/YGOProClient.test.ts
npm test -- src/ygopro/room/application/join-strategies/YGOProJoinHandlerStrategy.test.ts
npm test -- src/socket-server/YGOProServer.test.ts
npm test -- src/socket-server/WSYGOProVersionContract.test.ts
npm test -- src/socket-server/YGOProRoomLifecycle.test.ts
npm run lint
npm run test
npm run check:nostalgia-resources
npm run build
```

在本地服务使用系统分配的 loopback 端口启动后，再执行 0x1362 与 0x1361 的双环境冒烟。测试失败时按首个失败证据修复，不通过删除断言或放宽协议校验绕过。

## 10. 待评审确认

编码前确认以下产品范围：

1. 0x1361 是否按默认方案直接准入，不采用 srvpro 的首次拒绝/二次连接流程；
2. 是否接受本阶段只兼容实时对局，YRP/EVRP 录像继续保持 0x1362；
3. 是否在成功加入后向 0x1361 客户端发送一次兼容模式提示。

若前两项任一否定，需要先调整本设计和成功标准，再开始测试与编码。

## 11. 参考

- srvpro 兼容实现：<https://github.com/mycard/srvpro/tree/master/msg-polyfill>
- srvpro `0x1361` 转换器：<https://github.com/mycard/srvpro/blob/master/msg-polyfill/polyfillers/0x1361.ts>
- srvpro 许可证：<https://github.com/mycard/srvpro/blob/master/LICENSE>
- Core `MSG_CONFIRM_CARDS`：<https://github.com/Fluorohydride/ygopro-core/commit/48698bf>
- Client `MSG_CONFIRM_CARDS`：<https://github.com/Fluorohydride/ygopro/commit/f4db575>
- Core `MSG_SELECT_CHAIN`：<https://github.com/Fluorohydride/ygopro-core/commit/7c5796a>
- Client `MSG_SELECT_CHAIN`：<https://github.com/Fluorohydride/ygopro/commit/e7ebb75>
- Core `MSG_SELECT_SUM`：<https://github.com/Fluorohydride/ygopro-core/commit/cbb1053>
- Client `MSG_SELECT_SUM`：<https://github.com/Fluorohydride/ygopro/commit/db1633b>
