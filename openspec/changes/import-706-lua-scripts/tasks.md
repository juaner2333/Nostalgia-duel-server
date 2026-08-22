# 任务清单：import-706-lua-scripts

## 1. 预加载链路（代码先行，测试先行）

- [ ] 1.1 为 `YGOProResourceLoader` 新增预加载脚本路径派生（如 `getFormatPreloadScriptPaths(formatId)`：`formats/<id>/script/special.lua` 存在时返回其绝对路径，否则返回空数组），先写失败测试再实现
- [ ] 1.2 将 `src/ygopro/ocgcore-worker/ocgcore.ts` 中硬编码的 `extraScriptPaths: []` 替换为加载器派生结果，验证缺失 special.lua 时现有行为不变
- [ ] 1.3 为 `src/test-support/wasm/HistoricalRulingsDriver.ts` 接入同一预加载路径派生，使测试侧与生产 worker 行为一致

## 2. 上游脚本嵌入

- [ ] 2.1 以上游固定提交 `f993d739344f1914bcf8c54e90d638eb1fb45d45` 的 `specials/706` 为源，按各环境 LFList `$whitelist` 过滤后复制卡片脚本：1103 目录 374 张、1109 目录 375 张（`67750322` 仅入 1109；6 张双白名单外卡排除；8 张与 base 逐字节一致的照常纳入），重叠 10 张以上游版本替换，保留 `80168720`、`96782886`
- [ ] 2.2 将 `special.lua` 复制进两个 format 脚本目录（逐字节一致）
- [ ] 2.3 新增全量脚本 WASM 加载测试（遍历两环境全部脚本逐个加载并断言无脚本错误）；发现不可用写法（如 `#tg` 取 Group 长度）时做最小修复并逐条记录为本地偏差

## 3. 覆盖校验与行为测试

- [ ] 3.1 重写 `src/ygopro/ygopro/historical-rulings/coverage.test.ts`：断言 1103 恰 376 个卡片脚本 + `special.lua`、1109 恰 377 + `special.lua`；同 ID 双环境逐字节一致；全部卡片在 base CDB 与对应白名单；排除 6 张不存在、`67750322` 不在 1103；`special.lua` 双环境一致
- [ ] 3.2 重跑既有 12 张卡的 WASM 行为场景（`batch1.test.ts`、`necrovalley.test.ts` 等）：行为不变者保留断言，因上游边缘语义差异变化者按实测调整断言（不得删除场景覆盖）
- [ ] 3.3 新增 `special.lua` 行为场景测试：反转召唤被无效不视为场上送墓、被无效怪兽保持可苏生、`Card.GetFlipEffect`/`Auxiliary.dserodcon` 对卡脚本可用、preload 发生在卡片脚本加载前
- [ ] 3.4 执行 `npm run generate:nostalgia-lock` 重新生成资源锁，核对差异仅为两 format 脚本目录与 lock 摘要，跑 `npm run check:nostalgia-resources` 通过

## 4. 台账与终验

- [ ] 4.1 更新 `docs/historical-card-rulings.md`：记录上游仓库与固定提交、被上游版本替换的 10 张及差异、保留的 2 张、排除的 6 张及原因、本地偏差修复清单；候选章节同步（仍不进入运行时的卡片保持现状）
- [ ] 4.2 终验：`npm run lint`、`npm run test`、`npm run build`、双环境 `npm run smoke:duel` 全部通过；确认 CDB、两份 LFList 与卡池基线未变化
