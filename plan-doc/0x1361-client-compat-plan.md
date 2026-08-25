# Plan：版本不匹配时明确提示用户升级客户端（继续仅支持 0x1362）

> 状态：待评审（未经确认不实施）
>
> 性质：错误反馈改进，不包含任何版本兼容
> 关联：玩家反馈“连不上服务器” → 排查结论为 0x1361 客户端被版本校验拒绝，但客户端侧表现为静默失败（只收到版本错误帧、无文本、立即断开），用户看不到原因

## 1. 背景与事实边界

- 服务器当前在 `YGOProRoomState.validateVersion` 硬校验 `version !== 0x1362`；不匹配时发送 `VersionError` 帧并抛错，`YGOProWaitingState.handleJoin` 捕获后直接 `close()`。`VersionError` 帧仅携带期望版本号 `0x1362`，没有人类可读文本；多数旧客户端在加入阶段不展示该错误，用户只看到“连不上服务器”。
- 上游 `2c3d2e4`（2025-06-29）从 `0x1361` 升到 `0x1362` 时同时升级了 ocgcore 和脚本子模块，升级前后并非“所有线协议消息零差异”。已确认至少存在以下决斗消息变化：
  - `MSG_CONFIRM_CARDS`：新增 `skip_panel` 字节（core `48698bf` / client `f4db575`）；
  - `MSG_SELECT_CHAIN`：全局 `forced` 改为每个候选项携带 `forced`，字段布局变化（core `7c5796a` / client `e7ebb75`）；
  - `MSG_SELECT_SUM`：`sum_param` 解释规则变化（core `cbb1053` / client `db1633b`）。
- 因此旧版本客户端即使被放行，也可能在决斗中错位解析、错误响应、卡死或断开。**本计划不做任何版本兼容**：继续只接受 `0x1362`，仅把版本拒绝从“静默失败”改为“发送协议错误帧 + 用户可见的升级提示”。

## 2. 现状（改动前基线）

| 位置 | 现状 |
|---|---|
| `src/ygopro/ygopro/protocol-version.ts` | 仅 `YGOPRO_PROTOCOL_VERSION = 0x1362` |
| `src/ygopro/config/index.ts` | 再次硬编码十进制版本 `4962`，与协议版本常量存在漂移风险 |
| `src/ygopro/room/domain/YGOProRoomState.ts` `validateVersion` | `!== 0x1362 → send(VersionErrorClientMessage) + throw "Version mismatch"`（错误帧先发，抛错不带实际版本号） |
| `src/ygopro/room/domain/states/YGOProWaitingState.ts` `handleJoin` | 捕获版本错误后仅 `logger` 无记录、`socket.close()`；不发送任何用户可见提示 |
| 错误帧 | `0900020400000062130000`（期望版本仍为 `0x1362`），测试已锁定为 `VERSION_ERROR_FRAME_HEX` |
| 聊天提示帧 | `YGOProPlayerChatMessage`（STOC_CHAT `0x19`）已存在并用于 `:score` 等提示，可直接复用；UTF-16 上限 512 单元，足够放下中文提示 |
| `scripts/smoke-duel.mjs` | 使用 `0x1362` 执行双环境完整决斗冒烟，不涉及版本拒绝路径 |

## 3. 目标与成功标准

### 3.1 本次目标

- 任何版本号 `!== 0x1362` 的客户端连接时：仍发送 `VersionError` 帧（保持 YGOPro 原生校验语义），并**额外发送一条用户可见的升级提示**（告知服务器仅支持 `0x1362`、请升级客户端），随后关闭连接。不再静默失败。
- 拒绝时记录一条结构化 `warn` 日志，包含实际连接版本号，便于统计被拒客户端分布与复现。
- `0x1362` 的准入、房间、决斗和观战行为零回归，不收到任何新增提示。
- 版本拒绝不产生房间副作用：房间人数、席位、原玩家均不受影响（与现状一致）。

### 3.2 明确不做

- 不做 `0x1361`（或任何其他版本）的准入放行、实验性白名单或“兼容”。
- 不做任何决斗消息的版本转换。
- 不改动非法房间标识等其他“按设计静默拒绝”的路径——仅版本不匹配需要用户提示。

### 3.3 可验证的成功标准

- `0x1361`、`0x1360`、未知新版本（如 `0x1363`）加入时：依次收到 `VersionError` 帧与升级提示帧，随后断开；房间及其玩家不受影响。
- 提示文本包含“升级客户端”与协议版本 `0x1362`。
- `0x1362` 成功入房时不收到提示帧，现有固定帧序断言与完整冒烟继续通过。
- 日志可区分版本拒绝（含实际版本）与其他拒绝，不记录完整握手、昵称原始字节等敏感数据。

## 4. 最小改动方案

### 4.1 版本判定保持不变（仅消除常量漂移）

- `protocol-version.ts` 仍是唯一事实来源，**不新增任何白名单、范围判断或实验版本常量**。
- `validateVersion` 的判定逻辑不变：`!== 0x1362 → send(VersionError) + throw`。
- 将 `src/ygopro/config/index.ts` 的 `4962` 改为引用 `YGOPRO_PROTOCOL_VERSION`，消除重复事实来源（与提示文案同源，保证版本号一致）。

### 4.2 版本拒绝路径发送升级提示

`YGOProWaitingState.handleJoin` 的现有 catch 分支（保持 `validateVersion` 单职责：发错误帧 + 抛错）：

1. `validateVersion` 抛出的错误消息携带实际版本号（如 `Version mismatch: got 0x1361, expected 0x1362`），不硬编码文本；
2. catch 中先记录 `logger.warn`（拒绝原因 + 实际版本号，不记录原始帧数据）；
3. 通过现有 `YGOProPlayerChatMessage`（STOC_CHAT `0x19`）向该 socket 发送一次升级提示，文案由 `YGOPRO_PROTOCOL_VERSION` 生成，例如：

```text
当前服务器仅支持协议版本 0x1362；你的客户端版本不受支持，请升级客户端至最新版本后再连接。
```

4. 维持 `socket.close()`：`close()` 依次刷新已发送的错误帧与提示帧后关闭，错误帧先于提示帧。

- 提示帧在加入前发送：客户端若不渲染加入前聊天，协议错误帧仍是兜底，不会比现状更差。
- TCP 与 WebSocket 加入路径共用 `handleJoin`，提示自动覆盖两条传输。

### 4.3 固定样本

- 不新增 `0x1361` 完整首包样本（版本拒绝不需要准入路径样本）。
- `VERSION_ERROR_FRAME_HEX` 保持不变，仍是人工核对的固定二进制断言。
- 升级提示帧内容由测试解码断言（`ygopro-msg-encode` 的 `YGOProStocChat` 解码，与既有测试对 `YGOProStocJoinGame` 的解码方式一致），不引入新的手工二进制样本。

### 4.4 测试（测试优先）

先新增失败测试，再修改生产代码（当前只会收到 1 帧，新期望为 2 帧 + 关闭）。

#### TCP 准入契约测试

修改 `src/socket-server/YGOProServer.test.ts` 的 “rejects an unsupported client version”：

- `0x1361`：先收到 `0900020400000062130000`，再收到一帧 `0x19` 聊天帧（解码后包含“升级”与“0x1362”），随后连接关闭；房间人数/席位不变、`trap.handled` 为空；
- 新增参数化用例：`0x1360`、未知新版本（如 `0x1363`）同样收到错误帧 + 提示帧 + 关闭；
- `0x1362` 现有人房测试保持不变：不收到提示帧，固定帧序断言不改；
- 保留现有非法房间标识静默拒绝、分片、粘包、截断帧和房间副作用测试（语义不变）。

#### 日志断言（如现有测试具备 Logger mock）

- 版本拒绝产生一条含实际版本号的 `warn` 日志，且不包含完整首包原始字节。

### 4.5 规格与文档同步

- `openspec/specs/ygopro-only-server/spec.md`：版本不匹配场景改为“错误帧 + 升级提示帧 + 关闭”，主协议版本仍为 `0x1362`。
- `AGENTS.md` 线协议条款：补充“版本错误除原生错误帧外，必须向用户发送可读的升级客户端提示；禁止以静默关闭作为唯一的用户交互”。
- `README.md`：协议说明同步“仅支持 `0x1362`，版本不匹配会提示升级客户端”。
- `CHANGELOG.md`：按“版本不匹配提示升级”描述，不出现“兼容/放行”字样。

## 5. 回归与上线验证

### 5.1 合入前自动验证

1. 聚焦运行新修改的 TCP 准入测试（确认修改前失败、修改后通过）；
2. `npm run lint`；
3. `npm test`；
4. `npm run check:nostalgia-resources`；
5. `npm run build`；
6. `npm run smoke:duel`：继续使用 `0x1362` 验证 1103/1109 建房、卡组、WASM 决斗和观战零回归。

### 5.2 真实客户端观察

- 上线前使用反馈玩家的旧客户端实测：升级提示是否可见、断开时机是否正常、旧客户端是否会额外弹出自己的版本错误对话框。
- 实测结论仅描述该具体客户端构建；若个别构建不渲染加入前的聊天帧，错误帧仍是协议兜底，不为此追加兼容逻辑。

### 5.3 上线观察

- 观察版本拒绝 `warn` 日志：按版本号分布统计，确认提示后玩家不再反复重连或能正确升级客户端。
- 本变更不涉及任何准入放行，无需白名单回滚路径；如提示文案/帧序有问题，仅需回退本变更。

## 6. 风险与影响范围

- 提示帧在加入完成前发送：部分客户端可能在完成加入前不渲染聊天窗口内容，提示可能不可见——已有错误帧兜底，且不劣于现状，需在 5.2 实测确认主流构建可见性。
- `YGOProPlayerChatMessage` 使用 `player_type 0x09`：客户端渲染样式（普通聊天或系统消息）不确定，但不影响协议正确性与关闭行为。
- 拒绝路径仅多发送一帧并补充日志，不改变房间状态、准入、决斗流程，影响面小、易回滚。
- 旧客户端 `PlayerInfo` 名字字段垃圾字节等其他已知差异不在本计划范围（同 `0x1361` 决斗消息差异一样，作为“不做兼容”的事实依据记录）。

## 7. 不做的事

- 不把 `0x1361` 或任何其他版本加入白名单，不做“实验性放行”，不引入 `ALT_VERSIONS` 环境变量。
- 不放宽为 `>= 0x1361` 或任何范围判断，不实现 `MSG_CONFIRM_CARDS`、`MSG_SELECT_CHAIN`、`MSG_SELECT_SUM` 等决斗消息版本转换。
- 不保存按版本的协议模式，不支持同房混合版本对局。
- 不新增 `0x1361` 固定首包样本，不修改 `smoke-duel.mjs`。
- 不改变非法房间标识等既有“静默拒绝”语义——只有版本不匹配需要用户提示。
- 不记录完整握手、昵称原始字节或其他敏感数据。

## 8. 执行顺序

按 SOP-002（测试优先）：

1. 修改 4.4 的 TCP 准入测试（期望两帧 + 关闭 + 房间不受影响），运行确认失败（现状只有一帧）；
2. 实现 4.1～4.2 的最小代码改动；
3. 运行聚焦测试直至通过，再执行 5.1 的完整验证；
4. 同步 4.5 的规格与文档；
5. 使用具体旧客户端执行 5.2 的上线前观察；
6. 发布后按 5.3 观察提示效果与被拒版本分布。

## 9. 参考

- YGOPro 上游版本变更：
  - `a8a1bac`：`0x1360 → 0x1361`；
  - `2c3d2e4`：`0x1361 → 0x1362`，同时更新 ocgcore/script；
  - `db1633b`、`f4db575`、`e7ebb75` 与 Core `cbb1053`、`48698bf`、`7c5796a`：对应决斗消息解析变化（作为“不做兼容”的事实依据）。
- 现有实现：`src/ygopro/room/domain/YGOProRoomState.ts`（`validateVersion`）、`src/ygopro/room/domain/states/YGOProWaitingState.ts`（`handleJoin`）、`src/ygopro/messages/server-to-client/VersionErrorClientMessage.ts`、`src/ygopro/messages/server-to-client/YGOProPlayerChatMessage.ts`、`src/socket-server/YGOProServer.test.ts`（`VERSION_ERROR_FRAME_HEX`）。