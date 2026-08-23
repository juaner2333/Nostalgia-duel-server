## Why

在 2C4G 基准压测下，系统存在两个显著痛点：
1. **开局 CPU 突发（高达 3.6 核）**：40+ 场对局同时开局时，40 个独立 V8 Isolate 同时从头 JIT 编译 `libocgcore.wasm`，导致 56 场并发时 `MSG_START` 延迟超过 15 秒并触发超时失败（5/56 FAIL）。
2. **关房竞态误报平局（71 次）**：对局正常结束或投降调用 `dispose()` 时终止 Worker，挂起的 `advance()`/`process()` 抛出通道中断异常，被误判为服务器内部错误，不仅污染告警日志，还可能向客户端补发多余的平局广播。
3. **冷启动首局 12s 延迟**：服务启动时未预热格式卡表与 WASM，首批玩家体验较差。

通过聚焦实施收益最高、风险最低的 3 项外科手术式优化，以极小代码改动直接解决核心瓶颈。

## What Changes

- **WASM 预编译共享（硬依赖）**：主线程在启动阶段从 `koishipro-core.js` 安装位置解析并调用 `WebAssembly.compile()` 预编译 `libocgcore.wasm`（以 Promise 缓存单飞去重），通过 `@TransportEncoder` 安全透传 `WebAssembly.Module` 给 Worker 实例直接绑定（`WebAssembly.instantiate`），彻底消除多 Worker 并发 JIT 编译的 CPU 暴峰。预编译模块是硬依赖：启动预编译失败即进程 fail-fast；运行时模块缺失或损坏时 Worker init 显式失败，不回退到 Worker 内编译。同变更清理既有 `ocgcoreWasmBinary`/`ocgcoreWasmPath` 死管线（`getOcgcoreWasmBinary()` 恒返回 `undefined`，从未被真正传入 Worker）。
- **isDisposing 优雅关房状态机**：在 `OCGCore` 中增加 `isDisposing` 标志，在 `disposeWithTimeout()` 首行（null 检查之前）同步置位且销毁幂等（重复销毁直接静默返回）。正常关房、投降以及对局胜负消息（`YGOProMsgWin`）触发的 Worker 通道关闭被识别为正常生命周期结束，彻底消除 71 次误报平局与错误日志，并顺带消除 double-dispose 产生的 `Worker has been finalized` reject 噪音与 60s dispose 超时 warn。
- **服务启动全量预热**：在 `bootstrapYgoproResources` 启动阶段完成 `WebAssembly.Module` 预编译以及 `1103` 与 `1109` 环境 `formatCardStorage` 的加载，任一预热失败即阻止服务开始监听端口（fail-fast），消除首次请求 12s 冷启动耗时（残余的每 Worker 胶水 JS require 与页缓存后 ms 级文件读取保留，预热消除的是编译与卡池加载大头）。

## Capabilities

### New Capabilities
- `duel-startup-performance`: 涵盖 WASM 预编译共享、关房生命周期优雅退出与启动全量预热的核心性能与稳定性保证规范。

### Modified Capabilities

## Impact

- **受影响代码**：
  - `src/ygopro/ocgcore-worker/ocgcore.ts`
  - `src/ygopro/ygopro/YGOProResourceLoader.ts`
  - `src/ygopro/ocgcore-worker/ocgcore-worker-options.ts`
  - `src/ygopro/ocgcore-worker/ocgcore-worker.ts`
  - `src/bootstrap/bootstrapYgoproResources.ts`
  - `src/ygopro/ygopro/card-storage.ts`（清理 `ocgcoreWasmBinary` 死管线：属性、构造参数与 `fromCards`/`filterByCardIds`/`filterForFormat` 透传）
  - `src/ygopro/ygopro/card-load-worker.ts`（清理 `ocgcoreWasmPath` 参数及其 wasm 读取/哈希块）
- **协议与数据兼容性**：
  - 100% 保持 YGOPro 线协议与网络报文兼容。
  - 100% 保持固定资源（`nostalgia-resources/` 及 `lock.json`）纯净与不可变。
  - 100% 保持 Thread-per-Duel 强隔离与零状态污染，不引入复杂的池化状态泄漏风险。
