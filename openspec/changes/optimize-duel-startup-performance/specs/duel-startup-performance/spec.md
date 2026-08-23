## Purpose

定义怀旧决斗服务端的开局性能与稳定性契约，包括主线程 WebAssembly 预编译与多 Worker 共享实例化、关房生命周期优雅退出与启动全量预热，保证高并发开局下无 CPU 突发超时、无状态污染与无虚假平局误报。

## ADDED Requirements

### Requirement: 跨 Worker 共享预编译 WebAssembly 模块与安全传输

服务端必须（SHALL）在主线程启动阶段从 `koishipro-core.js` 安装位置解析并读取 `libocgcore.wasm`，使用 `WebAssembly.compile()` 预编译为 `WebAssembly.Module`，并以 Promise 缓存实现单飞去重（预热未完成时并发初始化不得重复编译）。
系统不得（SHALL NOT）将 WebAssembly 二进制移入 `nostalgia-resources/` 目录以避免破坏固定资源契约与资源锁。
在将 `WebAssembly.Module` 通过工作线程选项传递给 Worker 时，必须（SHALL）使用原生透传编解码器（Identity Transport Encoder）且仅使用该编码器，确保结构化克隆算法完整保留 `WebAssembly.Module` 实例，不得（SHALL NOT）将其作为普通对象序列化为空壳。
Worker 必须使用预编译模块实例化；模块缺失或损坏时 Worker 初始化必须（SHALL）显式失败，不得（SHALL NOT）回退到 Worker 内编译，亦不得（SHALL NOT）无限挂起。

#### Scenario: 并发对局初始化直接使用预编译模块
- **WHEN** 多个决斗房间同时进入 READY 并启动决斗 Worker
- **THEN** 每个 Worker 基于预编译模块完成实例化绑定并正常驱动对局，开局过程无重复的 WebAssembly 字节码编译 CPU 尖峰

#### Scenario: WASM 来源解析与资源树独立性
- **WHEN** 服务端加载并编译 WebAssembly 模块
- **THEN** WASM 二进制来自 `koishipro-core.js` 的 `vendor/wasm_cjs/libocgcore.wasm`，`nostalgia-resources/` 目录树与 `lock.json` 保持无 WASM 输入且哈希校验完全一致

#### Scenario: 传输编解码器防空壳测试
- **WHEN** 主线程通过 `initWorker` 向 Worker 传递 `WebAssembly.Module`
- **THEN** Worker 能基于接收到的模块实例化并驱动对局（行为断言），且接收到的参数满足 `instanceof WebAssembly.Module`（辅助断言）

#### Scenario: 实例化失败必须显式暴露
- **WHEN** 传入损坏或不匹配的 `WebAssembly.Module` 触发实例化失败
- **THEN** Worker 初始化以 init 错误拒绝（在有界限的时间内失败），不会无限挂起等待实例化回调

### Requirement: 优雅处理决斗关房与投降生命周期

当房间结束、玩家投降或对局主动调用 `dispose()` 时，系统必须（SHALL）在第一优先级标记当前对局为正在销毁状态（`isDisposing = true`），销毁标志必须在首次销毁请求时同步置位，且销毁过程必须（SHALL）幂等（重复销毁请求静默返回，不产生错误日志或超时告警）。对局胜负消息（`YGOProMsgWin`）触发的销毁同样必须（SHALL）先置位再销毁，不依赖消息处理的 microtask 时序。由于 Worker 线程终止或通道关闭导致的挂起推进调用异常，系统必须（SHALL）将其作为正常生命周期结束处理，不得（SHALL NOT）记录为内部服务器错误，亦不得（SHALL NOT）向下发额外的平局游戏广播消息。

#### Scenario: 玩家在对局中正常投降
- **WHEN** 玩家发送投降指令触发对局销毁与 Worker 资源释放
- **THEN** 系统正常结算胜负并广播胜利消息，不产生 `Error while advancing ocgcore` 错误日志，亦不下发额外的平局广播

#### Scenario: 真实引擎运算超时或崩溃
- **WHEN** 对局在非正常销毁状态下发生运算超时或 Worker 异常崩溃
- **THEN** 系统按既有容错逻辑记录错误日志并以平局保护广播通知对局双方

#### Scenario: 正常胜负结算无销毁噪音
- **WHEN** 对局因胜负已分正常结束（含三局两胜切换 side-decking 触发的重复销毁路径）
- **THEN** 全程不产生 `Error disposing ocgcore`、`Worker has been finalized` 或 dispose 超时告警日志

### Requirement: 服务启动全量资源与卡池预热

服务端在完成资源锁校验后、开始监听网络端口之前，必须（SHALL）预加载 `1103` 与 `1109` 两个环境的卡池存储（CardStorage）并完成 WebAssembly 模块预编译；任一预热步骤失败必须（SHALL）阻止服务开始监听端口（fail-fast）。

#### Scenario: 服务启动后首次对局开局
- **WHEN** 客户端连接到新启动的服务端并加入 `1103` 或 `1109` 房间开局
- **THEN** 首次对局开局延迟与稳态对局开局延迟一致（小于 1 秒），不存在首局冷加载长耗时
