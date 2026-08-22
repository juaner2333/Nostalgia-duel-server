# 设计文档：import-706-lua-scripts

## Context

- 脚本查找链已固定为 format-first：`src/ygopro/ocgcore-worker/ocgcore.ts:143` 通过 `YGOProResourceLoader.getFormatScriptPaths`（`src/ygopro/ygopro/YGOProResourceLoader.ts:84-86`）取得 `[formats/<id>/script, base/script]`，worker 内以 `DirScriptReaderEx` 注册为 WASM 按需读取回调（`src/ygopro/ocgcore-worker/ocgcore-worker.ts:126-129`）。**卡片脚本嵌入无需改动该链路**——放入 format 目录即自动覆盖 base。
- 预加载机制已半成品：`ocgcore.ts:170` 硬编码 `extraScriptPaths: []`，worker 已支持逐个 `duel.preloadScript(path)`（`ocgcore-worker.ts:154-156`）；koishipro WASM 二进制中存在 `PreloadUds` 符号，`_preload_script` 会在加载脚本块后调用 `Auxiliary.PreloadUds()`。preload 发生在任何卡片脚本按需加载之前（worker init 顺序：注册 reader → createDuel → preload → 决斗开始）。
- 资源锁：`src/ygopro/ygopro/NostalgiaResourceGenerator.ts` 的边界检查要求 format 脚本目录仅含扁平 `.lua` 文件（`special.lua` 天然满足），`summarizeScripts`（:437-448）按目录记录 fileCount 与有序 `相对路径:sha256`。
- 上游 `special.lua` 钩住 6 个核心 API（`Card.IsPreviousLocation`、`Card.GetPreviousLocation`、`Card.IsFaceup`、`Card.GetPosition`、`Duel.NegateSummon`、`Card.RegisterEffect`）实现 2011 全局裁定，并提供 `Card.GetFlipEffect`、`Auxiliary.dserodcon` 供集合内卡脚本消费——**卡脚本集与 special.lua 互为依赖，必须一同嵌入**。
- 已量化差异：上游 381 张中 367 张与 base 不同、8 张逐字节一致、6 张不在 base 且不在任何白名单；374 张在 1103 白名单、375 张在 1109（`67750322` 仅 1109）；与本项目既有 12 张覆盖重叠 10 张（1 张逐字节一致，9 张有差异，多为注释缩进与写法风格，个别为边缘语义差异如弹射龟无 ATK>0 过滤、无 `math.floor`）；上游含 7 处 `#` 取 Group 长度写法（`#tg>0`），本核心是否支持需实测。

## Goals / Non-Goals

**Goals:**

- 1103/1109 的 format 脚本目录与上游固定提交 `f993d73` 的 706 集合对齐（按各环境白名单过滤），重叠 10 张采纳上游版本，保留 `80168720`、`96782886`。
- `special.lua` 在两环境每局决斗的卡片脚本加载前可靠执行，且生产 worker 与测试驱动器行为一致。
- 全量脚本通过真实 ocgcore WASM 加载验证，双环境冒烟不回归。

**Non-Goals:**

- 不替换或修改 `base/script`（base 保持现代回退语义）。
- 不引入运行时资源刷新、上游自动同步或任何新资源目录层级。
- 不处理台账候选章节的其余卡片（如第二批候选与光之支配者）。
- 不修改 CDB、白名单、LFList、房间规则、线协议与依赖。

## Decisions

### D1：脚本放置位置——format 目录 ×2（字节一致），不动 base

上游 374/375 张（按环境过滤）+ 保留 2 张直接复制进 `formats/{1103,1109}/script/`，同 ID 双环境逐字节一致；`base/script` 不变。

- 理由：format-first 查找链零代码改动即生效；与 `restore-2011-card-rulings` 建立的既有覆盖约定完全一致；base 仍是纯粹的现代回退层。
- 备选（否决）：改写 base 中 367 个对应脚本——base 是双环境共享的现代基线，混入 2011 版本破坏其语义，且无法逐环境过滤（`67750322` 仅 1109）。
- 备选（否决）：新增共享 `formats/706/script` 层——需改动查找链与资源生成器，违反「资源根布局固定」的归档约束。

### D2：special.lua 预加载——资源加载器派生绝对路径，经 `extraScriptPaths` 传入

`YGOProResourceLoader` 新增方法（如 `getFormatPreloadScriptPaths(formatId)`）：当 `formats/<id>/script/special.lua` 存在时返回其绝对路径，否则返回空数组；`ocgcore.ts` 用返回值替换硬编码的 `extraScriptPaths: []`；`src/test-support/wasm/HistoricalRulingsDriver.ts` 同步接线。

- 理由：路径由领域层 format 注册表派生，符合「路径由领域层派生」的既有架构约束；显式、可单测、缺失时行为可断言（保持现状空列表）。
- 备选（否决）：向 worker 传相对名 `"special.lua"` 依赖 reader 的候选链（`specials/`、`expansions/script/` 前缀）解析——与 koishipro 内部路径约定隐式耦合，且文件缺失时静默无操作。
- 备选（否决）：把 special.lua 放 base/script——base 语义为现代回退，2011 全局补丁属环境行为，应随 format 目录发布与校验。

### D3：冲突处理——重叠 10 张采纳上游版本（用户决策）

9 张差异卡以上游为准，其中 `26202165` 本就一致。既有针对这 12 张卡的 WASM 场景测试在 apply 阶段逐一重跑：行为不变则保留断言；因上游边缘语义差异（如弹射龟解放 0 攻怪兽、伤害不取整）而变化者，按上游实测行为调整断言并在台账记录差异。

### D4：白名单过滤与排除——以 LFList `$whitelist` 为唯一事实来源

嵌入时逐环境过滤：`67750322` 仅入 1109 目录；6 张双白名单外卡（`27847700`、`57728571`、`61468779`、`82301904`、`83555667`、`92661479`）排除。8 张与 base 逐字节一致的脚本一并纳入（固定上游集合，防 base 未来漂移）。过滤为一次性操作，不落地常驻工具。

### D5：覆盖校验测试改为结构不变量，而非硬编码全量清单

`historical-rulings/coverage.test.ts` 重写断言：1103 目录恰 376 个卡片脚本 + `special.lua`、1109 恰 377 + `special.lua`；同 ID 双环境逐字节一致；全部脚本卡片在 base CDB 与对应环境白名单内；排除清单中的 6 张不存在于任何 format 目录、`67750322` 不存在于 1103；`special.lua` 双环境一致。「集合等于上游固定提交」由嵌入操作与台账（记录固定提交）保证，不在测试中重复固化 376 个 ID。

### D6：全量加载验证——单次对局内逐脚本 preload

新增 WASM 加载测试：创建一次真实引擎对局，对两个 format 目录的全部脚本（含 special.lua 之后）逐个调用引擎脚本加载（preload 或等价底层调用，断言无脚本错误）。卡脚本顶层仅定义函数、不执行效果，preload 足以暴露语法错误、未定义常量（如 `#tg` 类写法在执行期才会暴露的除外——由 D3 的行为场景与冒烟兜底）。

## Risks / Trade-offs

- [上游写法在本核心不可用（7 处 `#` 取 Group 长度等）] → apply 阶段最先执行全量加载测试；失败脚本逐个最小修复并在台账「本地偏差」记录，修复不改变 2011 语义。
- [9 张被替换卡片与我方 WASM 验证版本有边缘语义差异] → 既有场景测试逐一重跑核对；差异行为按上游调整断言并记录，属本次决策预期变更而非回归。
- [RegisterEffect 等全局钩子影响面广，可能波及未预期卡片] → special.lua 为上游 706 实战验证补丁；以完整回归套件 + 双环境冒烟兜底，并为「反转召唤被无效」关键路径补 WASM 场景。
- [两目录合计约 755 个文件使 lock 与 diff 变大] → lock 摘要机制不变（有序 path:sha256 聚合）；台账记录上游提交作为集合语义的紧凑事实来源。
- [既有 12 张相关测试与 necrovalley 等场景可能失败] → 属采纳上游版本的预期调整；仅允许为对齐上游行为修改断言，不得删除场景覆盖。

## Migration Plan

- 资源与应用为单一版本：脚本、`special.lua` 与重新生成的 `lock.json` 随同一提交发布；回滚随应用版本整体回滚，无数据迁移。
- 发布前置：`npm run lint`、`npm run test`、`npm run check:nostalgia-resources`、`npm run build`、双环境 `npm run smoke:duel`。

## Open Questions

- 是否以及如何周期性跟踪上游 706 目录的后续更新（本次仅建立 `f993d73` 基线）——属运维约定，不影响本次架构与任务拆分，留待后续变更决策。
