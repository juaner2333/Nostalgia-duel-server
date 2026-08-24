# Nostalgia Duel Server — 异画卡 +1 代码修复（cards.cdb 数据补丁 + 最小卡池数量常量更新）

## 摘要

修复玩家上传"异画卡"（客户端码 = 原码+1，如 70095155 alias=70095154）时服务器逐卡校验失败（UnknownCardError → DECKERROR）的问题。经排查，根因链为：`YGOProDeckCreator.build` → `CardYGOProRepository.findByCode` → `YGOProResourceLoader.getFormatCardReader(formatId)` → `filterForFormat(whitelist)`。**两处硬阻塞叠加**：
1. 服务器 `base/cards.cdb` 无这些异画码（base 卡池 5199 → 需 +184 左右）；
2. 环境卡池按 lflist 白名单过滤，异画码不在白名单 → `findByCode` 直接返回 null。

已获用户拍板的两项决策：
- **允许最小 Node 常量更新**：`EXPECTED_NOSTALGIA_POOL_SIZES`（base/1103/1109）及其测试断言，否则服务器/镜像构建因 `assertFixedPoolSizes` 校验失败而拒绝启动（无法交付可部署版本）。
- **两个环境（1103 与 1109）白名单都加**，规则：该环境白名单中包含基础卡码（base ∈ 该环境 whitelist）才加入其异画码，数量沿用该基础卡在该 lflist 中的原禁限数量。

其余保持"只改数据/资源，不做服务层兼容"约束（新增 `EXPECTED_NOSTALGIA_POOL_SIZES` 常量一行更新属数据契约，非兼容 hack）。

## 执行步骤（按序）

### 1. 点 A 实证：ocgcore 对"无脚本异画码"是否按 alias fallback 加载效果脚本

- 在仓库内新增 `src/ygopro/ygopro/alt-art-script-lookup.test.ts`，复用既有 `HistoricalRulingsDriver` 的完整生产链路（`createOcgcoreWrapper` + 生产 CardStorage(filterForFormat) + 生产脚本链 `DirScriptReaderEx(formatDir, baseDir)`）：
  - 注册一个**记录脚本质**的 spy reader（顺序在前、返回 null 放行）→ 再挂真实 DirScriptReaderEx；
  - 用补丁后的 cdb，把异画码（如 70095155 / 10802916 / 44508095 / 97077564 / 97268403 / 83764719）放入真实 WASM 决斗（MZONE 正面、startDuel、runUntil 稳定）；
  - 断言引擎请求过的脚本路径集合：若出现 `c{base}.lua`（如 c70095154.lua）即证明 fallback 存在（**Plan A 成立**）；若只请求 `c{add}.lua` 即无 fallback。
- 佐证（如执行期网络可用）：尝试 `raw.githubusercontent.com/purerosefallen/ygopro-core/master/ocgcore/card.cpp` 读 `load_card_script` 源码。
- **分支**：
  - **有 fallback** → 只补 cdb + 白名单（Plan A），不新增脚本。
  - **无 fallback** → 在资源层为"基础卡在 base/script 有脚本"的异画码生成改名副本 `c{add}.lua`（对 `c{base}` 作全词替换为 `c{add}`），保证效果可用（Plan B，仍属资源层，不改 Node 逻辑）；再重生成 lock。
  - 无论哪种，回归测试按实测行为固化该分支（保证效果始终可用）。

### 2. 写补丁脚本并执行（repo 内，可审计、可复跑）

新增 `scripts/patch-alt-art-cards.mjs`（依赖仓库既有 `sql.js` / `ygopro-cdb-encode`）+ 将 `/tmp/duel-fix/patch-list.csv` 固化到 `patches/alt-art-patch-list.csv`：

- **前置校验（失败即停）**：
  - 每个 `base_code` 必须存在于服务器 cdb（datas/texts 都有）；
  - 每个 `add_code` 不得已存在于 cdb 或任一白名单；
  - 与 `/tmp/babel.cdb` 交叉核对：add_code 的英文名与 base 一致（一次性 preflight，不写入脚本运行时依赖）；
  - **跳过**：复制后 `type & TYPE_TOKEN (0x4000)` 的行（token 不可入卡组，且不进 `lock.json` 的 token 脚本引用校验，否则 `writeNostalgiaResourceLock` 抛"多余 token"错误）。逐行打印跳过清单（预期含 64382841 等，以待实测确认为准）。
- **INSERT 数据**（逐列复制 base 行，仅改 id 与 alias）：
  - `datas`：id=add_code，其余字段照抄 base，**alias = base_code**（匹配 BabelCDB 约定；保证 `LimitedCardValidationHandler`/`AvailableCardValidationHandler` 别名归组、防 3×异画+3×本体 绕禁限）；
  - `texts`：id=add_code，name/desc/str1..16 照抄 base（保留中文名与原始编码字节）。
- **白名单追加**：分别解析 1103/1109 lflist 的 `$whitelist` 区；对 base ∈ 该环境白名单的行追加 `add_code <该基础卡在本 lflist 的数量(0-3)>`；1109=全量基础池、1103=子集。
- **输出并断言**：inserted=N、skippedTokens=M、新 base=5199+N、新 1103=5002+n1103、新 1109=5120+n1109；并断言原始 5199 个 id 集合完整保留（纯追加、零修改，从而既有 19 局所用卡不受影响）。

### 3. 最小 Node 常量与测试同步（唯一服务层改动）

- `src/ygopro/ygopro/NostalgiaResourceGenerator.ts`：`EXPECTED_NOSTALGIA_POOL_SIZES` 更新为步骤 2 打印的精确值（base/1103/1109），并刷新模块头部注释（5120 实卡 +79 token → 新实卡数）。
- `src/ygopro/ygopro/NostalgiaResourceGenerator.test.ts`：`BASE_POOL_SIZE` / `POOL_1103_SIZE` / `POOL_1109_SIZE` 及其两处错误消息字符串（"expected 5199/5002"）同步为精确值。
- `src/ygopro/ygopro/ResourcePoolResolver.integration.test.ts`：3 处规模断言（`baseStorage.size`、`storage1103.size`、`storage1109.size`）同步。

### 4. 重新生成 lock 并校验

- 顺序：`npm run build` → `npm run generate:nostalgia-lock`（官方途径，`writeNostalgiaResourceLock` 会按 `sha256(sorted ids join "\n" + "\n")` 自动重算 base/formats 的 cardIdsSha256、count、sha256，以及 scripts 哈希）→ 覆盖 `nostalgia-resources/lock.json` → `npm run check:nostalgia-resources` 通过。

### 5. 回归验证

- 将 `/tmp/parse_decks.js`（cdb 路径改为 repo 补丁后 cdb）复跑 `/tmp/neos7_decks.txt` 四份报文 → 全部 `found`，无 FIRST MISSING。
- `npm run test` 全量（含新增异画回归测试）。
- `npm run lint`。
- 可选：`npm run smoke:duel`（若用户提供运行中实例；USE_REDIS=false 零中间件即可）验证 1103/1109 真实决斗。
- 既有 19 局卡不受影响：原 5199 id 零修改（步骤 2 断言）+ 全量测试绿。

### 6. 点 C 复核（17626381 补给部队）

- 执行期用 sqlite 读 `/tmp/babel.cdb` 17626381：确认英文名 "Supply Squad"、alias=0、发行晚于 2011 → 怀旧卡池外新卡，**不在 184 清单内（正确）**，保持拒绝，写入变更说明。

### 7. 交付物

- 补丁后资源：`nostalgia-resources/ygopro/base/cards.cdb`、`formats/1103/lflist.conf`、`formats/1109/lflist.conf`、`lock.json`。
- 源码变更：1 常量（+注释）+ 2 个测试文件规模断言 + 新增 `alt-art-script-lookup.test.ts`。
- 工具与依据：`scripts/patch-alt-art-cards.mjs`、`patches/alt-art-patch-list.csv`。
- 变更说明：`docs/alt-art-card-pool-fix.md`（根因、点 A 实证结论与证据、新增/跳过明细、17626381 定性、回滚方式 git revert、部署步骤）。
- 文档一致性：更新 `AGENTS.md` 中对 1103/1109 基础卡池规模的 3 处描述（"不得扩展卡池"条款改为"异画卡补丁为受控扩展"）。

## 部署

重建镜像（`docker compose up -d --build` 或用户自有流程）。**必须重建**：Dockerfile 构建时执行 `npm run check:nostalgia-resources` 门禁（新规模需新常量），且运行容器内的 `assertFixedPoolSizes` 在启动时就地校验；对运行中容器热替换资源不可行。

## 验收标准

- `npm run check:nostalgia-resources` 通过；`npm run test` 全绿（含异画回归测试，其断言反映实测 fallback 结论）。
- Neos7 四份卡组报文复跑全部通过、不再 DECKERROR。
- lock.json 里的 count/cardIdsSha256/scripts 与补丁后资源逐一匹配。
- 变更说明含：点 A 实证结论、184 清单实际插入数、token 跳过清单、17626381 复核结论。

## 已锁定的假设

- 所有新行 `datas.alias = base_code`。
- 异画码在各自环境的禁限数量 = 其基础卡在该 lflist 的数量（0–3），且只加 base ∈ 该环境白名单的行。
- 1109=全量基础池（新=5120+n1109），1103=子集（新=5002+n1103）；最终精确值以补丁脚本输出为准并写死进常量。
- 若实测确认无 alias fallback，则按 Plan B 为"基础卡有脚本"的异画码生成改名脚本副本（资源层），保证效果可用。
