# Nostalgia Duel Server — CDB 与 Lua setcode 兼容性修复计划

## 摘要

修复固定怀旧资源中 `cards.cdb` 与 Fluorohydride Lua 脚本的 archetype `setcode` 编码代际不一致问题。已确认的用户可见症状包括：

- 【紫炎的道场】在召唤六武众后不增加指示物；
- 【紫炎的狼烟】无法检索等级 3 以下六武众。

根因不是 Lua 异常，而是合法过滤条件恒为 false：当前脚本按新版编码查询 `0x103d`，当前固定 CDB 中相关六武众仍保存为旧编码 `0x3d`。同类不兼容还涉及剑斗兽、地缚神、荷鲁斯和魅惑女王，不能只修改两张反馈卡的 Lua。

本计划采用以下修复决策：

- 保留当前 5,399 条固定 CDB、双环境白名单、异画码和 token；
- 仅同步当前卡片的 `datas.setcode` 到与锁定脚本配套的编码；
- 不整体替换为 14,981 条的现代 Moecube CDB；
- 不批量回退 base 或 format Lua；
- 先建立真实 WASM 失败用例，再应用数据补丁；
- 应用、CDB、Lua、LFList 与 `lock.json` 继续作为同一版本发布和回滚。

## 已确认的证据

### 1. 资源来源

- 旧 `master-origin` manifest 的 YGOPro CDB 来源：`https://cdntx.moecube.com/ygopro-database/zh-CN/cards.cdb`；
- manifest 将其组装为 `ygopro/base/cards.cdb`，但没有 commit 或 checksum，属于浮动输入；
- 当前 base Lua 固定来源：`Fluorohydride/ygopro-scripts@090e881772f488e1256c456b827d5cbed4facf79`；
- 本次下载并审核的 Moecube CDB：
  - SHA-256：`ced2a783338629892bdae7e60cb1fdbf50a5a688dcf5958e6b54224b0ce91c8f`；
  - HTTP Last-Modified：`2026-08-24 15:33:52 +08:00`；
  - 14,981 条 `datas`/`texts` 记录；
- 当前固定 CDB：
  - SHA-256：`051ad640864d49d9b653d24ee1354ea5090fe31687695737a046d5270ebb1168`；
  - 5,399 条 `datas`/`texts` 记录。

由于旧 manifest 没有锁定版本，本次下载文件只能作为本次补丁的已审核来源，不能声称是旧服务某次拉取结果的逐字节复原。最终仓库不得保留整份现代 CDB，只保留经过审核的行级补丁清单、固定 CDB 和生成后的资源锁。

### 2. 字段级差异

两份 CDB 共有 5,385 个卡片 ID，差异如下：

| 比较项 | 结果 |
| --- | ---: |
| 当前 CDB 独有 ID | 14（均为本地异画码） |
| 下载 CDB 额外 ID | 9,596（主要为现代卡） |
| 共同卡中任一 `datas` 字段不同 | 966 |
| `setcode` 不同 | 136 |
| `ot` 不同 | 889（1109 白名单内为 872） |
| `category` 表面不同 | 11（仅 signed/unsigned 表示差异，32 位内容一致） |
| `alias/type/atk/def/level/race/attribute` 不同 | 0 |
| 任一 `texts` 字段不同 | 574 |

本次只处理 `setcode`：

- 不同步 `ot`，因为两个 CDB 中所有固定白名单卡都保留 OCG 位，当前 OCG 准入结果一致；
- 不同步 `category`，因为 11 条差异的 32 位内容一致；
- 不同步名称、描述或提示字符串，避免无关文本漂移；
- 不同步攻击力、守备力、等级、种族、属性、类型或 alias，这些字段本身已一致。

### 3. 已确认的脚本不兼容范围

对 format-first 生效脚本和 1103/1109 固定卡池做静态匹配，确认至少存在以下零命中条件：

| 查询 setcode | 分类 | 当前 CDB 命中 | 下载 CDB 命中 | 生效脚本范围 |
| --- | --- | ---: | ---: | ---: |
| `0x103d` | 六武众 | 0 | 22 | 40 个实际生效脚本 |
| `0x1019` | 剑斗兽 | 0 | 1103: 29 / 1109: 30 | 36 个直接 setcode 过滤脚本 |
| `0x1021` | 地缚神 | 0 | 9 | 15 个直接 setcode 过滤脚本 |
| `0x119d` | 荷鲁斯 | 0 | 3 | 1 个直接 setcode 过滤脚本 |
| `0x3` | 魅惑女王 | 0 | 3 | 卡片脚本和公共函数 |

静态扫描未发现“当前 CDB 有命中、下载 CDB 反而零命中”的 setcode 查询。

### 4. 706 format 覆盖的关系

【紫炎的道场】`c47436247.lua` 和【紫炎的狼烟】`c54031490.lua` 不存在于两个 format 目录，1103/1109 都回退加载 base 脚本。

但每个 format 的 706 覆盖中另有 9 个脚本直接使用新版高位 setcode，因此同样受到当前 CDB 影响：

| 分类 | 覆盖脚本 |
| --- | --- |
| 六武众 `0x103d` | `c27821104.lua`、`c27970830.lua`、`c32603633.lua`、`c64398890.lua`、`c65685470.lua`、`c90397998.lua`、`c95519486.lua` |
| 剑斗兽 `0x1019` | `c55136228.lua` |
| 地缚神 `0x1021` | `c46263076.lua` |

以上 9 个文件在 1103/1109 中逐字节一致。

另有两个 706 覆盖仍查询旧的低位基类编码：

- `c83039729.lua`（六武众的师范）查询 `0x3d`；
- `c25924653.lua`（剑斗兽 马斗）查询 `0x19`。

YGOPro core 的 setcode 匹配允许低位基类查询命中新版 subtype，因此它们在 CDB 同步后应继续工作；仍需用真实 WASM 回归锁定这一行为。

## 目标与非目标

### 目标

- 恢复 base 和 706 format 覆盖对固定卡池 archetype 的正确识别；
- 让修复过程可审计、可复跑、失败时可回滚；
- 保持当前 1103/1109 卡池、禁限数量、历史 Lua 覆盖和应用行为边界；
- 为本次问题建立永久的 CDB 契约与真实 WASM 回归。

### 非目标

- 不引入下载 CDB 的额外现代卡；
- 不更新 CDB 文本、卡片数值或 `ot`；
- 不修改任一 base/format Lua；
- 不增加第三个 format、动态资源下载或运行时兼容逻辑；
- 不在本变更中部署生产环境；部署需在实现和验证完成后单独确认。

## 执行步骤（测试优先，按序）

### 1. 固化补丁来源与行级清单

新增 `patches/nostalgia-setcode-patch.csv`，建议字段：

```text
card_id,old_setcode,new_setcode,card_name
```

生成并审核规则：

1. 仅比较当前固定 CDB 与来源 SHA-256 为 `ced2a...1c8f` 的下载 CDB；
2. 只记录两个 CDB 共同存在且 `setcode` 不同的卡片；
3. 预期共同卡补丁行数为 136；
4. `old_setcode` 与 `new_setcode` 使用无精度损失的十进制字符串或规范化 64 位表示；
5. 按 `card_id` 升序保存，禁止重复 ID；
6. 清单必须人工检查主要转换组：
   - 29 张 `0x19 → 0x1019` 剑斗兽相关卡；
   - 22 张 `0x3d → 0x103d` 六武众相关卡；
   - 9 张 `0x21 → 0x1021` 地缚神相关卡；
   - 荷鲁斯、魅惑女王及其余 modern taxonomy 补充；
7. 不将整份下载 CDB提交进仓库。

14 个当前独有异画码不在 136 行共同卡清单中。补丁工具需根据其 `alias` 原卡读取最终 setcode 并同步，确保异画码与原卡的 archetype 数据一致。

### 2. 先添加失败的 CDB 契约测试

新增 `src/ygopro/ygopro/NostalgiaSetcodeCompatibility.test.ts`，在修改 CDB 前运行并确认失败。

测试至少覆盖：

- 补丁 CSV 恰有 136 个唯一共同卡 ID；
- 当前 CDB 中每个目标 ID 的值必须为 CSV 的 `old_setcode` 或已应用后的 `new_setcode`，拒绝未知第三值；
- 应用后的固定 CDB 对所有清单 ID等于 `new_setcode`；
- 14 个本地独有异画码存在，且 setcode 等于各自 `alias` 原卡；
- `datas` 与 `texts` 都保持 5,399 条；
- 1103/1109 白名单 ID 集合与数量保持 5,198/5,320；
- 代表性卡片满足新版脚本契约：
  - 六武众的影武者：`0x103d`；
  - 剑斗兽代表怪兽：`0x1019`；
  - 地缚神代表怪兽：`0x1021`；
  - 荷鲁斯相关卡包含 `0x119d`；
  - 魅惑女王相关卡包含 `0x3`。

测试命名遵循项目约定：`describe` 描述被测资源契约，`it` 使用英文一般现在时且不包含 `should`。

### 3. 先添加失败的真实 WASM 行为测试

新增 `src/ygopro/ygopro/NostalgiaArchetypeEffects.test.ts`，复用 `HistoricalRulingsDriver` 的真实链路：

- 仓库内固定 CDB；
- `formats/<format>/script → base/script` 的生产查找顺序；
- stock `koishipro-core.js` WASM；
- 1103/1109 实际白名单与固定 token。

对 `1103`、`1109` 分别验证：

1. 【紫炎的道场】在六武众通常召唤/特殊召唤成功后增加一个武士道指示物；
2. 【紫炎的狼烟】存在等级 3 以下六武众时可以发动，并能把目标加入手牌；
3. 【六武之门】从 format 覆盖加载，并能识别六武众、累计指示物或提供相应操作；
4. 【剑斗兽的底力】从 format 覆盖加载，并能识别剑斗兽作为合法处理对象/费用；
5. 【地缚神 卡帕克·阿普】从 format 覆盖加载，并按同 archetype 唯一性规则处理；
6. 【荷鲁斯的仆人】能识别并保护荷鲁斯；
7. 【女王亲卫队】能识别魅惑女王；
8. 【六武众的师范】旧查询 `0x3d` 能命中新编码 `0x103d`；
9. 【剑斗兽 马斗】旧查询 `0x19` 能命中新编码 `0x1019`。

先确认当前 CDB 下至少已知的高位查询场景失败；禁止先改资源再补测试。

### 4. 实现严格、幂等的 CDB 补丁工具

新增 `scripts/patch-nostalgia-setcodes.mjs`，复用项目已有 `sql.js`，不引入新依赖。

工具行为：

1. 默认读取：
   - `nostalgia-resources/ygopro/base/cards.cdb`；
   - `patches/nostalgia-setcode-patch.csv`；
2. 检查 CDB SQLite schema 仅包含预期的 `datas`/`texts` 结构；
3. 检查 CSV header、行数、唯一 ID 和数值格式；
4. 每个 ID 必须同时存在于 `datas` 与 `texts`；
5. 当前值等于 `old_setcode` 时更新为 `new_setcode`；
6. 当前值已经等于 `new_setcode` 时跳过，保证幂等；
7. 当前值为其他值时立即失败，不覆盖未知状态；
8. 所有更新在单一事务内执行，任一失败全部回滚；
9. 更新共同卡后，根据 `alias` 同步 14 个本地独有异画码的 setcode；
10. 导出前后执行结构化对比，断言：
    - 卡片 ID 集合不变；
    - `datas`/`texts` 记录数不变；
    - 只有 `datas.setcode` 允许变化；
    - `alias/type/atk/def/level/race/attribute/ot/category` 零变化；
    - `texts` 全部字段零变化；
11. 输出更新、已应用跳过、异画继承和最终计数；
12. 再运行一次必须产生零更新并成功退出。

### 5. 应用补丁并审查二进制结果

只修改：

- `nostalgia-resources/ygopro/base/cards.cdb`。

明确禁止修改：

- `nostalgia-resources/ygopro/base/script/*.lua`；
- `nostalgia-resources/ygopro/formats/1103/script/*.lua`；
- `nostalgia-resources/ygopro/formats/1109/script/*.lua`；
- 两份 `lflist.conf`；
- CDB 的非 setcode 字段。

补丁后生成机器可读对比摘要，验收值为：

```text
datas.setcode：仅审核清单和必要的异画 alias 继承发生变化
其他 datas 字段：0 个变化
texts：0 个变化
卡片 ID 集合：0 个变化
1103/1109 白名单：0 个变化
base/format Lua：0 个变化
```

### 6. 运行聚焦测试并确认由红转绿

依次执行：

```bash
npm test -- src/ygopro/ygopro/NostalgiaSetcodeCompatibility.test.ts --runInBand
npm test -- src/ygopro/ygopro/NostalgiaArchetypeEffects.test.ts --runInBand
```

验收：

- CDB 契约测试全部通过；
- 九个真实 WASM 场景在 1103、1109 中通过；
- 测试确认 format 覆盖优先级没有改变；
- 测试不使用临时改写过的 Lua 或替代 CDB。

### 7. 重新生成资源锁

执行：

```bash
npm run generate:nostalgia-lock
npm run check:nostalgia-resources
```

审查 `nostalgia-resources/lock.json`：

允许变化：

- `inputs.baseDatabase.sha256`；
- 由 CDB 文件变化传导的整体资源摘要。

必须保持：

- base count = 5,399；
- base cardIdsSha256；
- 1103 count/cardIdsSha256 = 5,198/原摘要；
- 1109 count/cardIdsSha256 = 5,320/原摘要；
- 两份 LFList hash/SHA-256；
- base/format 脚本 fileCount 和 SHA-256；
- token 集合及其完整性断言。

不得手工编辑或伪造 `lock.json`。

### 8. 完整回归与构建

按项目完成门禁执行：

```bash
npm run lint
npm run test -- --runInBand
npm run check:nostalgia-resources
npm run build
```

随后启动使用仓库固定资源的本地实例，执行：

```bash
npm run smoke:duel -- <port>
```

期望输出：

```text
OK format 1103: players dueled, spectator admitted and watched (seats unchanged)
OK format 1109: players dueled, spectator admitted and watched (seats unchanged)
SMOKE PASS
```

## 预计文件变更

| 文件 | 操作 | 说明 |
| --- | --- | --- |
| `patches/nostalgia-setcode-patch.csv` | 新增 | 固化 136 行共同卡 setcode 映射及审核依据 |
| `scripts/patch-nostalgia-setcodes.mjs` | 新增 | 严格、事务化、幂等的数据补丁工具 |
| `src/ygopro/ygopro/NostalgiaSetcodeCompatibility.test.ts` | 新增 | CDB/卡池/异画资源契约 |
| `src/ygopro/ygopro/NostalgiaArchetypeEffects.test.ts` | 新增 | 双环境真实 WASM 行为回归 |
| `nostalgia-resources/ygopro/base/cards.cdb` | 修改 | 只同步经过审核的 `datas.setcode` |
| `nostalgia-resources/lock.json` | 重新生成 | 记录补丁后固定资源摘要 |

不修改 Lua、LFList、固定卡池规模常量和 `docs/historical-card-rulings.md`。历史裁定覆盖的成员和脚本字节不变，因此无需更新历史覆盖台账。

## 验收标准

- 两张用户反馈卡在 1103、1109 的真实 WASM 回归中恢复；
- 706 format 覆盖涉及的六武众、剑斗兽、地缚神代表行为恢复；
- 已知五组零命中 setcode 在固定卡池中均有正确候选；
- CDB 仅发生审核范围内的 `setcode` 变化；
- 5,399/5,198/5,320 数量基线保持；
- 14 个本地异画码和 79 个 token 完整保留；
- Lua、LFList、脚本摘要和卡片 ID 集合保持；
- 资源检查、聚焦测试、全量测试、lint、build、双环境 smoke 全部通过；
- 工作区不存在临时下载 CDB、临时测试或未追踪诊断文件。

## 发布与回滚

实现和验证完成后建议发布 `1.0.2`，但本计划不自动授权部署。

部署流程：

1. 按指定分支构建并推送 `1.0.2` 镜像；
2. 部署前查询活跃对局；
3. 在允许的窗口重启到新镜像；
4. 校验健康接口、资源版本接口和双环境完整决斗冒烟；
5. 所有验证通过后才结束发布。

回滚使用完整的 `1.0.1` 镜像，不单独回滚 CDB 或 Lua，确保应用、CDB、LFList、脚本和 lock 始终同版本。

## 已锁定的假设与权衡

- `setcode` 是 Lua 与 CDB 之间的运行时契约，优先与锁定脚本快照保持一致；
- 选择集中修改 CDB，是因为问题跨越 base 与 format 覆盖，回退 Lua 会形成大范围上游 fork 并容易漏改；
- 选择同步全部 136 个共同卡差异，而不是只修五组已暴露 archetype，以消除同一脚本/CDB 配对中的已知 taxonomy 漂移；
- 通过不更新文本、数值、`ot`、卡池和 Lua，把历史语义变化限制在脚本已经依赖的 archetype 识别层；
- 低位旧查询对新版 subtype 的兼容性不能只依赖静态推导，必须由真实 WASM 用例固化；
- 来源 CDB 是浮动 URL，因此只把本次已审核 SHA-256 派生出的行级映射纳入版本控制，不建立运行时下载或刷新路径。
