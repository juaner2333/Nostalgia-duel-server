## 1. 关房竞态修复 (isDisposing)

- [ ] 1.1 在 `OCGCore.disposeWithTimeout()` 首行（`if (!ocgcore) return` 之前）同步置位 `isDisposing`，并幂等化：已置位时直接静默返回，消除 double-dispose 的 `Worker has been finalized` reject 噪音与 60s 超时 warn 滞留
- [ ] 1.2 改造 `OCGCore.advance()`，在 `this.isDisposing` 状态下捕获到 Worker 中断异常时静默退出，不调用 `handleAdvanceError`
- [ ] 1.3 `handleAdvanceResult` 的 `YGOProMsgWin` 分支：置位 `isDisposing` 后再 dispose（消除对 floating `handleWinCondition → disposeCore` microtask 时序的依赖）
- [ ] 1.4 编写单元测试：a) `OCGCore` 销毁过程中 `advance()` 被 reject 时不触发平局广播与错误日志；b) double-dispose 静默（二次调用不产生 `Error disposing ocgcore`）；c) 正常胜负结算（含三局两胜切 side-decking）全程无 `Error disposing ocgcore` / dispose 超时日志

## 2. WASM 预编译与安全跨 Worker 共享（硬依赖）

- [ ] 2.1 在 `YGOProResourceLoader` 中实现 `getOcgcoreWasmModule()`：从 `koishipro-core.js` 入目解析 WASM 二进制并预编译 `WebAssembly.Module`，以 Promise 缓存单飞去重（沿用 `formatCardStoragePromises` 模式）；预编译失败抛出含版本耦合提示的错误（`koishipro-core.js@^1.5.2` 内部路径 `vendor/wasm_cjs/libocgcore.wasm`）
- [ ] 2.2 扩展 `OcgcoreWorkerOptions` 增加 `ocgcoreWasmModule` 字段，**仅使用** `@TransportEncoder` 透传（禁止叠加 `@TransportType`：同一 metadata key 后应用者胜出，会静默空壳化）
- [ ] 2.3 改造 `OcgcoreWorker.init()`：无条件使用 `instantiateWasm` 钩子基于共享 `WebAssembly.Module` 实例化，并在 `.then` 第二参数中显式传播 rejection（确保失败走 init-error 而非挂起）
- [ ] 2.4 改造 `OCGCore.init()` 将预编译的 `WebAssembly.Module` 传入 Worker（模块为硬依赖，缺失即报错，无 Worker 内编译回退）
- [ ] 2.5 编写 `OcgcoreWorkerWasmModule.test.ts` 集成测试：a) 真实 `initWorker` 传输 `WebAssembly.Module` 防空壳化（行为断言优先：实例化后可驱动对局 `process`，`instanceof WebAssembly.Module` 为辅）；b) 传入损坏模块时 init 必须 reject 而非无限挂起（带超时界限）
- [ ] 2.6 清理 `ocgcoreWasmBinary`/`ocgcoreWasmPath` 死管线：移除 `OcgcoreWorkerOptions.ocgcoreWasmBinary`、`YGOProResourceLoader.getOcgcoreWasmBinary()`、`OcgcoreWorker.init()` 的 binary 分支、`CardStorage.ocgcoreWasmBinary`（属性 + 构造参数 + `fromCards`/`filterByCardIds`/`filterForFormat` 透传）、`CardLoadWorker.ocgcoreWasmPath` 及其 wasm 读取/哈希块；确认无孤儿引用

## 3. 服务启动全量预热

- [ ] 3.1 在 `bootstrapYgoproResources` 中加入 1103/1109 双格式 `formatCardStorage` 与 `WebAssembly.Module` 的预热调用；任一预热失败即启动失败（在端口监听之前 fail-fast）

## 4. 验证与回归

- [ ] 4.1 执行 `npm run lint`、`npm run test` 与资源锁校验 `npm run check:nostalgia-resources`
- [ ] 4.2 对刚启动的实例执行双环境冒烟测试 `npm run smoke:duel`（默认端口 706），验证首局开局 < 1s（无冷加载长耗时）
- [ ] 4.3 压测验收（可执行口径，`scripts/load-test-duel.mjs`）：a) `node scripts/load-test-duel.mjs --mode duel --rooms 40 --cpu-cores 2` → 0 FAIL、MSG_START p95 < 1s、avg CPU < 配额 80%；b) `--mode churn` 长跑验证 `Error while advancing ocgcore` 竞态日志消除、无 dispose 噪音日志、无内存泄漏
