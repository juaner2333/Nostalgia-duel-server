## Context

怀旧决斗服务器（Nostalgia-duel-server）当前采用 Thread-per-Duel 架构运行 ocgcore C++/WASM 引擎。在 2C4G 压测中，稳态对局 CPU 极低（0.013 核/场），但开局并发时面临严重的 CPU 尖峰（3.6 核），同时快速关房时存在挂起推进抛错引发的 71 次伪平局日志。技术现状与约束包括：
- `koishipro-core.js` 底层使用 Emscripten 封装的 `libocgcore.wasm`。
- `nostalgia-resources` 资源库为静态固定卡池与脚本，文件总大小约 24MB，lock.json 不包含 wasm 文件。
- Node.js 的 `worker_threads` 原生支持基于 HTML 结构化克隆算法直接传递 `WebAssembly.Module` 实例，但 `yuzuthread` 传输层的元数据反射机制存在默认类序列化陷阱。

动机与需求详见 `proposal.md` 与 `specs/duel-startup-performance/spec.md`。

## Goals / Non-Goals

**Goals:**
- **消除开局 CPU 突发**：将 40+ 场同时开局时的 CPU 突发削减 85% 以上，单场开局耗时降至 1 秒以内。
- **消除关房竞态报错**：消除 `dispose()` 关房与投降时的 `Error while advancing ocgcore` 竞态日志与多余平局消息。
- **消除首局冷启动耗时**：将 1103/1109 卡池加载与 WASM 模块编译前置到服务启动期。
- **绝对保证强隔离与零污染**：保持 Thread-per-Duel 架构不变，杜绝任何跨局状态污染。

**Non-Goals:**
- 不引入复杂的 Worker 池化管理（避免 Lua `_G` 全局污染、C++ 静态内存残留与租约死锁风险）。
- 严禁将 `libocgcore.wasm` 挪入 `nostalgia-resources/`，不修改固定资源数据库（CDB）、禁限卡表（LFList）及资源锁（lock.json）。
- 不修改 YGOPro 线协议及网络数据包格式。

## Decisions

### 1. WASM 二进制来源解析与预编译（硬依赖）
- **方案**：主线程从 `koishipro-core.js` 安装位置解析 WASM 二进制，`getOcgcoreWasmModule()` 以 Promise 缓存实现单飞去重（沿用 `formatCardStoragePromises` 的既有模式，避免预热未完成时并发 init 重复编译）：
  ```ts
  const koishiproEntry = require.resolve("koishipro-core.js");
  const wasmPath = path.join(path.dirname(koishiproEntry), "vendor/wasm_cjs/libocgcore.wasm");
  const wasmBinary = await readFile(wasmPath);
  this.wasmModulePromise = WebAssembly.compile(wasmBinary);
  ```
- **失败语义（硬依赖，无软回退）**：启动阶段预编译失败（文件缺失、编译报错）为 fatal，进程 fail-fast，错误信息需明确提示版本耦合：`vendor/wasm_cjs/libocgcore.wasm` 是 `koishipro-core.js@^1.5.2` 的**包内部布局**（caret 范围，minor 升级可能移动该文件），升级依赖时必须验证该路径仍存在。运行时模块缺失或损坏时 Worker init 显式失败，不回退到 Worker 内编译，也不挂起。
- **理由**：`koishipro-core.js` 的 `package.json` 配置了 `exports`，直接 `require.resolve("koishipro-core.js/dist/vendor/...")` 会报错；通过入口目录相对解析既能锁定与胶水代码同版本同文件的 wasm，又能避免把 wasm 挪入 `nostalgia-resources` 破坏归档资源契约与 lock 锁。将预编译定为硬依赖并与 lock 校验同等对待，消除 Requirement 与降级路径之间的矛盾（旧行为隐含 `wasmBinary` 软回退，但 `getOcgcoreWasmBinary()` 恒返回 `undefined`，实为死路径，本次一并清理）。

### 2. 安全跨 Worker 传输 `WebAssembly.Module`（避开 yuzuthread 陷阱）
- **方案**：在 `OcgcoreWorkerOptions` 中声明 `ocgcoreWasmModule` 时，**只使用** `@TransportEncoder` 透传，禁止叠加 `@TransportType`：
  ```ts
  // 禁止叠加 @TransportType：两个装饰器写同一个 metadata key（"transporter"），
  // 后应用的胜出。若 TransportType 胜出，WebAssembly.Module 会走 CustomClass
  // 分支被序列化为空壳 {}，导致每个 Worker init 崩溃。encoder-only 时
  // encode/decode 路径中 encoder 优先级最高，安全。
  @TransportEncoder<unknown, unknown>((m) => m, (m) => m)
  ocgcoreWasmModule: unknown;
  ```
  在 Worker 内无条件使用 Emscripten 的 `instantiateWasm` 钩子直接实例化，并显式传播 rejection：
  ```ts
  createOcgcoreWrapper({
    moduleOverrides: {
      instantiateWasm(info: any, receiveInstance: (inst: any) => void) {
        WebAssembly.instantiate(wasmModule, info).then(
          (instance) => receiveInstance(instance),
          // 必须传播失败：否则 receiveInstance 永不调用，
          // removeRunDependency('wasm-instantiate') 永不执行，factory promise
          // 永不 settle，Worker init 无限挂起且无错误日志（比崩溃更糟）。
          (error) => { throw error; },
        );
        return {};
      },
    },
  });
  ```
- **理由**：`yuzuthread` 的 `BUILTIN_TYPES` 白名单不包含 `WebAssembly.Module`，`encodeValue` 的 CustomClass 分支基于 `Object.keys()` 复制字段，而 `WebAssembly.Module` 无可枚举自有属性，会被序列化为空对象 `{}`。透传后由 Node.js 原生 `postMessage` 结构化克隆安全传递（Node 24 已验证支持）。`instantiateWasm` 失败必须以 init-error 暴露，使 `initWorker` reject、房间创建显式报错。无 `wasmModule ? ... : undefined` 分支：模块是硬依赖，缺失即构造期报错。

### 3. 在 `OCGCore` 中引入 `isDisposing` 优雅关房状态机
- **方案**：在 `OCGCore` 内部维护 `private isDisposing = false;` 标志：
  - **置位位置**：`disposeWithTimeout()` 首行、`if (!ocgcore) return` **之前**同步置位，保证二次调用（如对局胜利消息触发 Win 分支 dispose 后，`disposeCore()` 再次调用）也能命中静默路径；
  - **幂等化**：`disposeWithTimeout()` 在已置位时直接静默返回，消除 double-dispose 产生的 `Worker has been finalized` reject 噪音与 60s dispose 超时 warn 滞留；
  - **Win 分支置位**：`handleAdvanceResult` 中收到 `YGOProMsgWin` 分支同样置位后再 dispose——当前靠 floating 的 `handleWinCondition → disposeCore` 在 microtask 中先跑来兑底属于时序巧合而非结构保证，显式置位消除对时序的依赖；
  - **advance 静默**：`advance()` 捕获到 Worker 通道断开异常时，若 `this.isDisposing` 为真则静默退出，不调用 `handleAdvanceError`。
- **理由**：由于 Worker 在对局结束时被销毁，挂起的 `advance()` 异步生成器抛出通道终止错误是正常的生命周期行为。显式区分正常销毁与异常崩溃，可彻底清除 71 次伪服务器错误平局报警。
- **有意取舍**：`isDisposing` 静默会吞掉 dispose 期间发生的真实引擎错误（如恰在关房时崩溃）。这是接受的取舍——对局已结束、胜负已结算，此时补发平局广播反而有害。
- **已知残余风险（不在本变更范围）**：dispose 进行中客户端 RESPONSE 到达时，`setResponse` 抛错被 `handleResponse` 捕获并调用 `room.setDuelFinished()`（将 `_state` 置回 `WAITING`），低频且不产生伪平局广播；后续如需修复应另立变更。

### 4. 服务启动全量预热（Bootstrap Pre-warming）
- **方案**：在 `bootstrapYgoproResources` 中显式触发 1103/1109 `formatCardStorage` 加载与 `WebAssembly.Module` 编译；任一预热失败即启动失败，阻止服务开始监听端口（fail-fast，与资源锁校验哲学一致）。
- **理由**：将所有冷启动加载与编译耗时全部收敛到服务启动阶段（耗时仅约 1~2s），使第一批加入房间的真实玩家享受与稳态一致的开局体验。
- **预期说明**："消除首局 12s" 指的是编译与卡池加载大头；每个 Worker 仍有胶水 JS require（~170KB）与 wasm 文件读取（~1.1MB，页缓存命中后 ms 级）的残余成本，不宜宣传为"零开销"，避免验收误判。

## Risks / Trade-offs

- **[风险] `WebAssembly.Module` 跨 Worker 传递空壳化** → 仅使用 `@TransportEncoder` 透传（禁止叠加 `@TransportType`：同一 metadata key 后应用者胜出，叠加会静默空壳化），并通过真实的 `initWorker(OcgcoreWorker, ...)` 集成测试断言锁定：行为断言（能实例化并驱动对局）为主，`instanceof WebAssembly.Module` 为辅。
- **[风险] `instantiateWasm` 失败导致 Worker 无限挂起** → 必须显式传播 rejection 使 init-error 生效；集成测试必须包含"传入损坏模块时 init reject 而非挂起"场景（带超时界限的失败）。
- **[风险] 三方包内部路径耦合** → `vendor/wasm_cjs/libocgcore.wasm` 是 `koishipro-core.js@^1.5.2` 的内部布局，minor 升级可能移动；启动 fail-fast 错误信息需提示该耦合，CI 与依赖升级 checklist 校验路径存在性。
- **[权衡] 为什么不使用 Worker Pool** → 相比于池化能额外节省的 ~50ms 线程启动时间，Thread-per-Duel 提供了绝对可靠的 C++/Lua 状态隔离与内存回收，彻底避免了潜在的恶性规则 Bug。
- **[已知残余] `setResponse` 竞态** → dispose 期间 RESPONSE 到达会触发 `room.setDuelFinished()` 将状态置回 `WAITING`，低频、无伪平局广播，本变更不处理（见 Decision 3）。

## Migration Plan

1. 纯代码层面的内部执行优化，不需要进行数据库迁移。
2. 同变更清理既有 `ocgcoreWasmBinary`/`ocgcoreWasmPath` 死管线（`OcgcoreWorkerOptions.ocgcoreWasmBinary`、`YGOProResourceLoader.getOcgcoreWasmBinary()`、`CardStorage.ocgcoreWasmBinary` 全链、`CardLoadWorker.ocgcoreWasmPath` 及其 wasm 读取/哈希块），确保无孤儿引用。
