# 变更提案：import-706-lua-scripts

## Why

1103 与 1109（统称 706 环境）目前仅有 12 张手工恢复的 2011 OCG 裁定覆盖，其余卡片在决斗中回退到现代 base 脚本。上游 `purerosefallen/specials` 仓库的 `706` 目录针对同一 2011 环境维护了 381 张卡的旧裁定脚本修正与一个全局核心 API 补丁 `special.lua`，经社区长期实战验证。全量嵌入可获得完整、可信的 706 环境脚本面，并与上游形成可持续同步的基线。

## What Changes

- 将上游 706 卡片脚本集（固定提交 `f993d739344f1914bcf8c54e90d638eb1fb45d45`）按各环境白名单过滤后嵌入 `formats/{1103,1109}/script/`：1103 纳入 374 张、1109 纳入 375 张（`67750322` 仅存在于 1109 白名单）；其中 8 张与当前 base 逐字节一致，按固定上游集合的原则一并纳入。
- 采纳上游版本替换现有 12 张覆盖中与上游重叠的 10 张（`26202165` 本就逐字节一致，其余 9 张以 upstream 版本为准）；保留上游没有的 2 张（`80168720` 暗之拜访、`96782886` 精神脑魔）。
- 排除 6 张不在任何环境白名单的死脚本（`27847700`、`57728571`、`61468779`、`82301904`、`83555667`、`92661479`）。
- 新增 `special.lua` 全局预加载补丁（双环境字节一致）：每局决斗在卡片脚本加载前执行，钩住 `Card.IsPreviousLocation`、`Card.GetPreviousLocation`、`Card.IsFaceup`、`Card.GetPosition`、`Duel.NegateSummon`、`Card.RegisterEffect` 六个核心 API，恢复「反转召唤被无效不视为场上送墓」「被无效的反转召唤怪兽保持可苏生」等 2011 全局裁定，并向卡脚本提供 `Card.GetFlipEffect` 与 `Auxiliary.dserodcon`。
- 启用预加载链路：`ocgcore.ts` 中硬编码为空的 `extraScriptPaths` 改为由资源加载器派生的 `special.lua` 路径；测试侧 WASM 驱动器同步支持。
- 更新覆盖校验测试（现断言两环境各恰好 12 个脚本文件）与台账 `docs/historical-card-rulings.md`，记录上游来源、冲突处理与排除清单；重新生成 `lock.json`。
- 不修改基础 CDB、卡片文本、卡池、禁限数量、房间规则、线协议或依赖；不引入 EDOPro 或未启用赛制资源。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `historical-card-rulings`: 覆盖集合需求从「12 张手工恢复卡片」扩展为「上游 706 全量脚本集（按白名单过滤、采纳上游版本）」；新增全局预加载补丁（`special.lua`）的加载与行为需求；台账需求扩展为记录上游来源与排除清单。

## Impact

- 固定资源：`nostalgia-resources/ygopro/formats/1103/script/`（12 → 约 377 个文件）、`nostalgia-resources/ygopro/formats/1109/script/`（12 → 约 378 个文件，含 `special.lua`）；`nostalgia-resources/lock.json` 重新生成。
- 运行时代码：`src/ygopro/ocgcore-worker/ocgcore.ts`（`extraScriptPaths` 接线）、`src/ygopro/ygopro/YGOProResourceLoader.ts`（预加载脚本路径派生）、`src/test-support/wasm/HistoricalRulingsDriver.ts`（测试驱动器同步）。
- 测试：`historical-rulings/coverage.test.ts` 断言重写；既有 12 张卡的 WASM 行为测试需按上游脚本重新核对（9 张存在语义或写法差异，如 `#tg` 取 Group 长度、弹射龟无 ATK>0 过滤与 math.floor）；新增全量脚本 WASM 加载验证与 `special.lua` 行为场景。
- 文档：`docs/historical-card-rulings.md` 台账重大更新（上游来源、9 张被替换卡片的差异记录、排除清单）。
- 风险：上游脚本面向特定 ocgcore 构建，个别写法（7 处 `#` 取长度）与边缘语义需在 koishipro WASM 中实测；既有 WASM 测试可能需按上游行为调整预期。
