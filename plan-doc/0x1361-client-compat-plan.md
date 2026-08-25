# Plan：实验性放行 0x1361 客户端（版本白名单）

> 状态：待评审（未经确认不实施）
>
> 性质：best-effort 实验性准入，不构成完整协议兼容承诺
> 关联：玩家反馈“连不上服务器” → 排查结论为 0x1361 客户端被版本校验拒绝

## 1. 背景与事实边界

- 服务器当前在 `YGOProRoomState.validateVersion` 硬校验 `version !== 0x1362`；不匹配时发送 `VersionError` 帧并关闭连接，因此所有报告 `0x1361` 的客户端都会在入房前被拒绝。
- 上游 `a8a1bac`（2024-06-03）仅将客户端版本从 `0x1360` 改为 `0x1361`。
- 上游 `2c3d2e4`（2025-06-29）将版本从 `0x1361` 改为 `0x1362` 时，同时升级了 ocgcore 和脚本子模块；升级前后并非“所有线协议消息零差异”。已确认至少存在以下决斗消息变化：
  - `MSG_CONFIRM_CARDS`：新增 `skip_panel` 字节（core `48698bf` / client `f4db575`）；
  - `MSG_SELECT_CHAIN`：全局 `forced` 改为每个候选项携带 `forced`，字段布局变化（core `7c5796a` / client `e7ebb75`）；
  - `MSG_SELECT_SUM`：`sum_param` 解释规则变化（core `cbb1053` / client `db1633b`）。
- 因此，版本号为 `0x1361` 的旧构建可能成功建房和开始决斗，但在遇到上述消息时错位解析、错误响应、卡死或断开。
- srvpro2 的 `ALT_VERSIONS` 只在 `JOIN_GAME` 阶段放宽版本校验并发送风险提示，不保存协议模式，也不转换决斗消息；其默认备选值为十进制 `2330/2331`（`0x091a/0x091b`），不是 `0x1361`。本计划只复用这种“实验性放行”模式，不据此宣称 `0x1361` 与 `0x1362` 完整兼容。

## 2. 现状（改动前基线）

| 位置 | 现状 |
|---|---|
| `src/ygopro/ygopro/protocol-version.ts` | 仅 `YGOPRO_PROTOCOL_VERSION = 0x1362` |
| `src/ygopro/config/index.ts` | 再次硬编码十进制版本 `4962`，与协议版本常量存在漂移风险 |
| `src/ygopro/room/domain/YGOProRoomState.ts` `validateVersion` | `!== 0x1362 → send(VersionError) + throw "Version mismatch"` |
| `YGOProWaitingState.handleJoin` | 捕获版本错误后 `close()`；错误帧先发送再关闭 |
| 错误帧 | `0900020400000062130000`（期望版本仍为 `0x1362`），测试已锁定 |
| 固定样本 `src/test-support/fixtures/ygopro-first-packet.ts` | 仅包含 `0x1362` 首包样本 |
| `openspec/specs/ygopro-only-server/spec.md` | 协议版本写死为 `0x1362` |
| `scripts/smoke-duel.mjs` | 使用 `0x1362` 执行双环境完整决斗冒烟 |

## 3. 目标与成功标准

### 3.1 本次目标

- 将 `0x1361` 加入显式实验性白名单，使其不再因版本号直接收到 `VER_ERROR`。
- `0x1361` 成功入房后，向该客户端发送一次明确的实验性兼容警告，建议升级到 `0x1362`。
- 记录 `0x1361` 放行日志，便于上线后统计、定位问题和快速回滚。
- `0x1360`、其他未列入白名单的旧版本以及未知新版本继续按现状拒绝。
- `0x1362` 的准入、房间、决斗和观战行为零回归。

### 3.2 明确不承诺

- 不承诺通用 `0x1361` 客户端可完成卡组操作、连锁选择或完整决斗。
- 不承诺 `0x1361` 与 `0x1362` 可以无风险混合对局。
- 不把“能够进房”表述为“协议完整兼容”。

### 3.3 可验证的成功标准

- `0x1361` 使用合法房间标识加入时，不收到 `VER_ERROR`，成功准入后收到正常入房响应和一次实验性兼容警告。
- `0x1360` 和任意不在白名单内的版本仍收到原版本错误帧后断开，且房间不发生变化。
- `0x1362` 成功入房时不收到实验性警告，现有完整冒烟继续通过。
- 日志可以识别实验性放行和版本拒绝，不记录新增的敏感握手原始数据。

## 4. 最小改动方案

### 4.1 版本常量与判定

`src/ygopro/ygopro/protocol-version.ts`：

```ts
export const YGOPRO_PROTOCOL_VERSION = 0x1362;

/** 仅放宽握手准入；不表示与主版本的全部决斗消息兼容。 */
export const YGOPRO_EXPERIMENTAL_VERSIONS: readonly number[] = [0x1361];

export function isExperimentalVersion(version: number): boolean {
	return YGOPRO_EXPERIMENTAL_VERSIONS.includes(version);
}

export function isVersionAccepted(version: number): boolean {
	return version === YGOPRO_PROTOCOL_VERSION || isExperimentalVersion(version);
}
```

- 使用精确白名单，不使用范围判断。
- 命名使用 `EXPERIMENTAL`，避免把未经完整验证的版本误标为 `COMPATIBLE`。
- `src/ygopro/config/index.ts` 改为引用 `YGOPRO_PROTOCOL_VERSION`，消除 `4962` 的重复事实来源。

### 4.2 放宽版本校验并返回实际版本

`YGOProRoomState.validateVersion` 仍是唯一版本拒绝点，但在校验成功后返回解析出的客户端版本：

```ts
protected validateVersion(message: Buffer, socket: ISocket): number {
	const joinMessage = new YGOProJoinGameMessage(message);

	if (!isVersionAccepted(joinMessage.version)) {
		socket.send(VersionErrorClientMessage.create(YGOPRO_PROTOCOL_VERSION));
		throw new Error(
			`Version mismatch: got 0x${joinMessage.version.toString(16)}, expected 0x${YGOPRO_PROTOCOL_VERSION.toString(16)}`,
		);
	}

	return joinMessage.version;
}
```

- 错误帧继续携带主版本 `0x1362`。
- 错误消息从常量派生，不再硬编码 `0x1362` 文本。
- `WaitingState.handleJoin` 的错误关闭路径保持不变。

### 4.3 实验性提示与日志

`YGOProWaitingState.handleJoin`：

1. 保存 `validateVersion` 返回的实际版本；
2. 捕获版本拒绝异常时记录拒绝原因，再按现状关闭连接；
3. 如果是 `0x1361`，记录一条结构清晰的 `warn` 日志；
4. 执行现有准入流程；
5. 仅在准入结果不是 `rejected` 时，通过现有 `YGOProPlayerChatMessage` 向该 socket 发送一次提示：

```text
当前客户端版本仅为实验性放行，决斗中可能出现卡死或异常；请升级至 0x1362。
```

- 不给主版本客户端发送提示。
- 不把客户端版本持久化到玩家、房间或对局记录；本次没有按版本转换消息的需求。
- 不记录完整首包、昵称原始字节或其他可能包含敏感信息的数据。

### 4.4 固定线协议样本

`src/test-support/fixtures/ygopro-first-packet.ts`：

- 保留现有 `0x1362` 主版本固定样本；
- 新增手工核对的 `0x1361` `JOIN_GAME` 帧和完整首包常量，版本字节固定为 `61 13`；
- 增加对应预期解析值 `version: 0x1361`；
- 测试期望不得由被测编码器动态生成。

### 4.5 测试（测试优先）

先新增失败测试，再修改生产代码。

#### 协议版本单元测试

新增 `protocol-version.test.ts`：

- `0x1362`：主版本，接受且不是实验版本；
- `0x1361`：实验版本，接受；
- `0x1360`：拒绝；
- `0x1363`：未知新版本，拒绝。

#### TCP 准入契约测试

修改 `src/socket-server/YGOProServer.test.ts`：

- `0x1361`：成功入房、房间人数正确、收到正常入房响应和一次警告、没有 `VERSION_ERROR_FRAME_HEX`；
- `0x1360`：仍收到 `0900020400000062130000` 后断开，房间及原玩家不受影响；
- `0x1362`：成功入房且不收到实验性警告；
- 保留现有非法房间标识、分片、粘包、截断帧和房间副作用测试。

#### 固定样本解析测试

修改 `src/shared/messages/MessageProcessor.test.ts`：

- 验证 `0x1361` 固定完整首包在整包、逐字节和代表性分片下仍按顺序解析；
- 验证 `JOIN_GAME` 解析出的版本为 `0x1361`；
- 不把此测试解释为决斗消息兼容证明。

### 4.6 规格与文档同步

- `openspec/specs/ygopro-only-server/spec.md`：主协议版本仍为 `0x1362`，补充“实验性接受 `0x1361` 加入，但不承诺完整决斗消息兼容”的场景。
- `AGENTS.md`：线协议条款改为“主版本保持 `0x1362`；仅可通过显式代码白名单实验性放行经评审的版本，不得解释为完整兼容”。
- `README.md`：协议说明同步主版本和实验性准入边界。
- `CHANGELOG.md`：使用“实验性放行/experimental admission”，不使用“完整兼容”。

## 5. 回归与上线验证

### 5.1 合入前自动验证

1. 聚焦运行新增协议版本、TCP 准入和固定样本测试；
2. `npm run lint`；
3. `npm test`；
4. `npm run check:nostalgia-resources`；
5. `npm run build`；
6. `npm run smoke:duel`：继续使用 `0x1362` 验证 1103/1109 建房、卡组、WASM 决斗和观战零回归。

### 5.2 真实客户端观察

- 上线前使用反馈玩家的具体 `0x1361` 客户端包至少执行一次建房、入房和实际决斗，记录其能到达的阶段。
- 实测结果只描述该具体客户端包，不外推到全部 `0x1361` 构建。
- 即使某次完整决斗成功，也不删除实验性警告，除非后续已覆盖已知差异消息并完成独立兼容评审。

### 5.3 上线观察与回滚

- 观察实验性版本放行日志、同房异常退出、响应超时、服务端判和和 Core 错误。
- 若 `0x1361` 明显增加卡死、超时或异常结束，直接从代码白名单移除 `0x1361` 并重新发布；主版本路径无需改动。
- 不以自动判负、判和或超时结束作为“兼容成功”的证据。

## 6. 风险与影响范围

### 6.1 已知协议风险

- `MSG_SELECT_CHAIN` 等新旧字段布局不同，旧客户端可能在常见连锁选择处错位解析；这不是只影响画面展示的问题。
- 客户端可能发送错误但格式合法的响应，Core 可能要求重试、等待超时或结束该对局。
- 服务端按房间/Worker 隔离处理，预期不会改变其他房间或所有 `0x1362` 客户端的协议；但与 `0x1361` 同房的 `0x1362` 玩家会共同承受等待、超时或异常结束。
- 异常结束可能进入录像、结算或统计链路，需通过日志观察实际影响。

### 6.2 其他客户端差异

- 部分旧客户端的 `PlayerInfo` 名字字段可能含未初始化垃圾字节；当前名字会参与重名判断、房间展示、身份解析和录像元数据，不能简单视为“只影响显示”。本变更不额外修复名字协议问题，发现实际影响时另开变更处理。
- 部分客户端缺少 `ExternalAddress (0x17)`；服务器当前不依赖该帧完成准入，因此不是本次阻塞项。

## 7. 不做的事

- 不实现 `MSG_CONFIRM_CARDS`、`MSG_SELECT_CHAIN`、`MSG_SELECT_SUM` 或其他决斗消息的版本转换。
- 不保存每个玩家的长期协议模式，不支持同房按版本双向翻译消息。
- 不承诺 `0x1361` 完整决斗可用。
- 不引入 `ALT_VERSIONS` 环境变量；实验版本保持代码级显式白名单，便于评审和回滚。
- 不放宽为 `>= 0x1361` 或其他范围判断。
- 不把 `smoke-duel.mjs` 改成 `0x1361`；主版本完整冒烟和实验版本准入测试职责分离。

## 8. 执行顺序

按 SOP-002（测试优先）：

1. 新增/修改 4.5 中的失败测试；
2. 实现 4.1～4.3 的最小代码改动；
3. 增加并核对 4.4 的固定二进制样本；
4. 同步 4.6 的规格与文档；
5. 执行 5.1 的完整验证；
6. 使用具体 `0x1361` 客户端执行 5.2 的上线前观察；
7. 发布后按 5.3 观察，必要时移除白名单回滚。

## 9. 参考

- YGOPro 客户端：
  - `a8a1bac`：`0x1360 → 0x1361`；
  - `2c3d2e4`：`0x1361 → 0x1362`，同时更新 ocgcore/script；
  - `db1633b`、`f4db575`、`e7ebb75`：对应决斗消息解析变化。
- YGOPro Core：`cbb1053`、`48698bf`、`7c5796a`。
- srvpro2：`src/pre-join/client-version-check.ts` 和 `src/config.ts`；其白名单只放宽加入校验并发送提示，不提供决斗消息转换。
