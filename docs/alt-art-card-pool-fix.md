# 异画卡(+1 码)修复：cards.cdb 数据补丁

> 变更类型：**资源数据修复**（cards.cdb + 1103/1109 whitelist + lock.json）+ **一处最小卡池契约常量更新**。
> 关联问题：客户端卡库包含"异画卡"条目（码 = 原码 + 小偏移，如 `70095155 → alias 70095154`），服务器怀旧卡库只有原码，导致卡组逐卡校验返回 `UnknownCardError`，玩家无法开局。

---

## 1. 根因

- 校验链路：`YGOProDeckCreator.build` → 逐卡 `cardRepository.findByCode` → `CardYGOProRepository` → `YGOProResourceLoader.getFormatCardStorage(formatId)` → `filterForFormat(whitelist)`。
- 格式卡池只包含 lflist 白名单中的码；异画码既不在 `base/cards.cdb`，也不在任何环境白名单 → `findByCode` 返回 null → 拒绝。
- 这里有两道门槛，缺一不可：
  1. **base cdb 数据**：异画码要有 `datas`/`texts` 行。
  2. **whitelist**：异画码要进 1103/1109 白名单，否则 `filterForFormat` 仍会把它们滤掉。

## 2. 决策与约束

- 用户拍板：**只改 cards.cdb 数据（修完重新部署），不在服务层(Node 代码)做兼容**。
- 唯一例外（已获用户确认）：`EXPECTED_NOSTALGIA_POOL_SIZES` 常量及其测试断言必须同步更新为补丁后精确卡池数量，否则资源锁校验（启动与 Docker 构建的 `check:nostalgia-resources`）会因数量不符而硬失败 —— 这是数据契约常量更新，非兼容逻辑。
- 两个环境（1103、1109）都加：以"基础卡是否在该环境白名单"为准，异画码数量沿用该基础卡的禁限数量。

## 3. 变更内容

### 3.1 cards.cdb（`nostalgia-resources/ygopro/base/cards.cdb`）
新增 **200** 条异画卡条目（`datas` + `texts`），从服务器对应原卡整行复制，并设置 `datas.alias = 基础码`：

- 复制字段（datas）：`ot, setcode, type, atk, def, level, race, attribute, category`（除 id/alias 外逐字复制）。
- 复制字段（texts）：`name, desc, str1..str16`（中文卡名/文本逐字复制）。
- `datas.alias = 基础码`：与 BabelCDB 异画条目约定一致；保证
  - `LimitedCardValidationHandler` 按 alias 归组限额（防止 3×异画 + 3×原卡 绕限）；
  - ocgcore 按 alias 回退加载原卡脚本（见 §5，决定异画卡在决斗中效果生效）。
- **跳过 1 条 token**：`64382841`（地外生命衍生物 / Eva Token，TYPE_TOKEN）。token 不进白名单、不能入卡组，且强制加入会导致资源锁的 token 校验失败；故不补。
- **两批合计**：第一批 183 条来自“同名词 + 窗口 [−5,+5]”扫描；第二批 17 条为审计后发现窗口外的更远异画（见 §3.6）。

总数：`5199 → 5399`。

### 3.2 白名单（`lflist.conf`）
- `formats/1109/lflist.conf`：确保 **200** 条，`5120 → 5320`。
- `formats/1103/lflist.conf`：确保 **196** 条，`5002 → 5198`。
- 追加块以 `# ALT-ART FIX: ...` 注释标记，条目数量沿用基础卡在该环境的 quantity（0–3）；基础卡不在该环境（如 `10000020` 天空龙、`10802915` 导游、`94145021` 小丑与锁鸟）的异画只进 1109（4 条）。补丁脚本“重建到全量集合”，可幂等、可增量追加。

### 3.3 lock.json（`nostalgia-resources/lock.json`）
用官方途径重算：`npm run build && npm run generate:nostalgia-lock`。
- `inputs.baseDatabase`：count `5399`，sha256、cardIdsSha256 更新。
- `formats.1103.cardPool`：count `5198`；`formats.1109.cardPool`：count `5320`。
- `cardIdsSha256` 算法（`NostalgiaResourceGenerator.summarizeCardPool`）：`sha256( 排序后的 id 由小到大以 "\n" 连接，末尾再追加 "\n" )`，由工具自动计算。

### 3.4 源码（唯一的 Node 改动）
- `src/ygopro/ygopro/NostalgiaResourceGenerator.ts`：`EXPECTED_NOSTALGIA_POOL_SIZES` 改为 `{ base: 5399, "1103": 5198, "1109": 5320 }`（注释同步）。
- `src/ygopro/ygopro/NostalgiaResourceGenerator.test.ts`：fixture 规模与两个错误文案断言更新为 5382/5181/5303。
- `src/ygopro/ygopro/ResourcePoolResolver.integration.test.ts`：三个卡池规模断言更新。
- **新增** `src/ygopro/ygopro/alt-art-script-lookup.test.ts`：真实 ocgcore WASM 回归测试，断言异画码触发基础码脚本（alias 回退，保证效果生效）。

### 3.6 二次扩展：窗口外的更远异画（17 条）
初次清单用“同名词 + 窗口 [+/−5]”扫描得到 184 条；复核后发现 4 张高人气卡在 BabelCDB 还有窗口外的异画码（`alias→主码`、type 为实卡、非 token），已补上 17 条：
- 青眼白龙（89631139）：`89631133(d−6)`、`89631145–89631148(d+6..+9)` 共 5 条。
- 黑魔术师（46986414）：`46986420–46986423(d+6..+9)` 共 4 条。
- 黑魔术少女（38033121）：`38033127–38033130(d+6..+9)` 共 4 条。
- 真红眼黑龙（74677422）：`74677428–74677431(d+6..+9)` 共 4 条。
排除的“同名但非异画”噪声：Polymerization `27847700`、Black Luster Soldier `10000100`、若干 token 复用码（距离极远，非异画）。

### 3.7 工具与文档
- 新增 `scripts/patch-alt-art-cards.mjs`：可复现/幂等的补丁脚本（输入 `patches/alt-art-patch-list.csv`，白名单按全量重建、可增量）。
- `patches/alt-art-patch-list.csv`：201 条补丁清单（1 条 token 被跳过 → 实补 200）。
- `AGENTS.md`：卡池规模相关事实数字更新（5198 / 5320 / 5399）。
- 本变更说明：`docs/alt-art-card-pool-fix.md`。

## 4. 验证

| 项 | 结果 |
| --- | --- |
| `npm run check:nostalgia-resources` | PASS（含新数量门禁） |
| `npm test`（含新增异画脚本回退测试） | 119 套件 / 836 用例 PASS |
| `npm run lint` | PASS |
| Neos7 异画卡组报文回归 | deck 1/2/3 全部通过；deck 0（17626381）按设计仍拒绝 |
| 原有 19 局所用卡 | 不受影响（纯 INSERT，未改动任何原行；基础 5199 码集合保持，仅新增） |

回归工具：`/tmp/parse_decks_local.js`（解析 `patches/…` 对应的补丁后 cdb）。

## 5. 关键取证：ocgcore 的 alias 脚本回退（§3 未完成项 A）

用真实 wasm（`koishipro-core.js` 的 `libocgcore`）+ 生产脚本链（`formats/1109/script` → `base/script`）+ 补丁后 cdb 实测：
放置异画码卡（如 `70095155`）进决斗，记录引擎请求的脚本路径，结果**只请求 `c{base}.lua`（例 `c70095154.lua`），从不请求 `c{alt}.lua`**。

- 样本：`70095155→70095154`、`10802916→10802915`、`44508095→44508094`、`97077564→97077563`、`97268403→97268402`。
- 结论：**ocgcore 按 `datas.alias` 回退加载原卡脚本**。因此补了 cdb 数据后，异画卡在决斗中效果完整生效，**无需生成任何 stub 脚本**（Plan A 即可）。

## 6. 未处理项：17626381（补给部队 / Supply Squad）

- BabelCDB 中 `17626381` 英文名 `Supply Squad`，`alias=0`（独立卡，非异画），2014 年发行，**在 2011 怀旧池之外**。
- 不在补丁清单（201 条）内（无同名词条配对），也**故意不补**：该玩家使用卡池外新卡，保持拒绝是正确行为。

## 7. 交付与部署

交付物（本仓库内）：
- `nostalgia-resources/ygopro/base/cards.cdb`
- `nostalgia-resources/ygopro/formats/{1103,1109}/lflist.conf`
- `nostalgia-resources/lock.json`
- 源码常量/测试改动 + 新增回归测试
- `scripts/patch-alt-art-cards.mjs` + `patches/alt-art-patch-list.csv`

**部署必须重构建镜像**（`docker compose up -d --build` 或既有流程）：Dockerfile 在构建期运行 `npm run build && npm run check:nostalgia-resources`，会以新数量门禁校验全部内容。热替换运行中容器的资源文件**不可行**：启动期 `bootstrapYgoproResources` 用编译后的旧常量做资源锁校验，重启即因数量不符而拒绝启动。

**回滚**：`git checkout -- nostalgia-resources` 还原资源树 + 还原 `NostalgiaResourceGenerator.ts` 常量相关提交，或直接 `git revert` 本变更；随后照常重构建。
