## Context

动机见 [proposal.md](./proposal.md)，外部契约见 [卡组详情规格](./specs/nostalgia-deck-detail/spec.md)、[使用率入口增量](./specs/nostalgia-usage-dashboard/spec.md) 和 [矩阵入口增量](./specs/nostalgia-half-year-deck-winrate-matrix/spec.md)。本变更涉及多页入口、全类型实时聚合、一致读取与历史不完整数据，需要在实现前固定查询边界。

- 页面由 `src/http-server/controllers/` 返回内嵌 CSS/脚本的 HTML，路由在 `src/http-server/routes/index.ts` 注册；无独立前端框架。HTTP 局部规则要求新接口使用 `{ success, data?, error? }` 包装。
- `matches` 是排位玩家视角记录，同一 `game_id` 对应双方；`match_decks` 保存 G1 前冻结的分类。`duels.duel_index=1` 与 `is_first` 可提供可信 G1 座次。现有账号昵称可用于公开玩家详情导航。
- `DECK_TYPE_CATALOG` 当前有 1109 的 D01–D30、OTHERS，以及 1103 的 OTHERS。历史 Side 缺失不影响本次类型统计；不重新读取卡片或执行分类。
- 现有 `stats_deck_matchups` 仅保存前 16 具名类型间且已知 G1 座次的每日结果，无法还原名单外、未知对手或未知座次。使用率批次也包含其他类型及不同有效性范围。
- 已有索引覆盖 `matches(format_id,date,id)`、`matches(format_id,game_id)`、`match_decks(format_id,deck_type_code,match_id)` 和未软删的 `duels(match_id,duel_index)`。`matches.date` 是无时区时间戳，生产容器设置 `TZ=Asia/Shanghai`，本查询需使用显式北京时间墙钟参数匹配现有存储，而不能依赖测试进程或数据库会话默认时区。
- `add-player-detail-page` 已实现但尚未归档；其总/半年统计、全时期历史与凭据边界是本次入口改造的前置契约。历史快照回填与部署进度不被视为历史数据齐全的保证。

## Goals / Non-Goals

**Goals:**

- 一个详情响应的使用份数、分母、合计、对手行和玩家榜使用同一取数快照及样本定义。
- 查询向 Node 返回有界聚合结果，以现有事实与索引实现全类型统计，不修改决斗及每日统计链路。
- 将未知分类、未知座次与其他类型严格区分；通过真实 PostgreSQL 场景验证 SQL 与领域契约一致。

**Non-Goals:**

- 不新建统计表、索引迁移、缓存、后台任务、分类解释器、登录会话或前端组件框架。
- 不将详情当作对全部排位场次的绝对使用率，也不改写已有使用率和矩阵的统计样本。
- 不读取单份卡组数组、录像 bytea、账号敏感字段，不从录像在线回填或推导未知座次。

## Decisions

### 1. 独立查询用例，通过领域端口注入数据库适配器

在 `src/shared/stats/deck-detail/` 建立最小模块：

- `domain/DeckDetailRules.ts`：校验环境、半年、选择输入，构建具名目录和样本规则，定义计数不变量、比例与稳定排序；`DeckDetailDto.ts`、`DeckDetailRepository.ts` 定义带中文字段说明的结果和查询端口。
- `application/GetDeckDetail.ts`：执行输入校验、目录搜索与选择，选中后调用一次仓库快照查询，再组装公开 DTO。无选择或搜索多命中只返回目录候选，不扫描比赛。
- `infrastructure/postgres/DeckDetailPostgresRepository.ts`：参数化查询与一致事务，按领域查询契约过滤和聚合，不将原始比赛清单加载进应用。
- HTTP 新增页面 Controller 与查询 Controller，经构造函数注入用例；在现有路由入口完成装配，沿用公开限流和排位开关。

```text
使用率 / 前16矩阵 / 玩家详情
              │ 环境 + 类型 + 半年
              ▼
      卡组详情 HTML ── GET 详情 API
                            │
                       GetDeckDetail
                            │ 领域查询端口
                            ▼
                    PostgreSQL 只读快照
                 matches / match_decks / duels
                            │
                  使用占比 + 对阵 + Top10
```

新 API 按 HTTP 目录规则包装 `{success:true,data:...}`，错误包装 `{success:false,error:...}`；新页面自行解包，既有 API 返回格式不被改动。当前接口中存在直接返回 DTO 的历史实现，本次采用局部明文规范，不批量统一旧接口。

备选：扩展现有矩阵用例或让 Controller 自行拼 SQL。前者受限于已有持久化数据范围，后者绕过领域与应用边界，均不采用。

### 2. 固定“具名本方、具名或未知对手、排除其他”的样本

仓库用环境和半年时间范围定位候选物理 `game_id`，再读取同环境该比赛的完整视角组，确认总视角数恰为 2、用户不同、双方均未撤销且未软删、结算处于查询窗口、比分与整场胜负互补。先完成完整性检查再筛选具名本方，避免提前过滤掉第三条记录或无效对手后把异常比赛误认成有效比赛。

通过 `(match_id,format_id)` 关联初始快照，按环境目录解释代码。任一方为 `OTHERS` 时整场排除，不能将其转换为未知。没有快照的本方不进入具名使用分母；没有快照的对手可以保留为 `unknown`，但双方比赛身份仍必须完整。异常的非空分类代码或跨环境快照不得被伪装成可信具名分类，隔离该物理比赛。每个具名本方视角计一次，内战自然形成两个视角、总胜场为一。

所有聚合使用相同仓库内局部样本 CTE，参数由领域契约给出；不创建通用 SQL 规则引擎。领域校验最终计数和分母，集成测试以独立固定场景证明数据库筛选语义，防止三种查询逐渐采用不同过滤条件。

备选：使用单方 `matches.winner` 忽略对手完整性，或以录像分页作为统计输入。前者无法可靠排除撤销一方和歧义记录，后者会把多局 Match 重复统计，均不采用。

### 3. G1 未知保留综合，计数显式守恒

G1 投影仅关联本场两个玩家的 `duel_index=1`、未软删、`game_id` 与玩家身份匹配的小局；只有各自唯一且 `is_first` 一真一假时座次可信。任一方缺失、未知或冲突，双方均归为未知座次。G2/G3、房间座位和比分不参与推导。

对每个对手与合计返回八个整数计数，领域断言：

```text
matches   = firstMatches + secondMatches + unknownSeatMatches
matchWins = firstWins    + secondWins    + unknownSeatWins
每种条件的 wins 都在 [0, matches] 内
合计 = 具名对手行 + unknown 行
usage.count = 合计.matches
```

页面由胜场和场数计算百分比，零分母为“数据不足”，保留未知座次场数说明。未知对手可有已知 G1 座次，两种“未知”不能混为一个条件。

备选：沿用矩阵的完全排除未知 G1 规则。详情是所选具名卡组的综合 Match 查询，保留有效结算结果能够更完整展示历史，且通过未知计数解释综合与先后攻分母的差异。

### 4. 每日预聚合物理表，卡组详情极速点查

为彻底消除运行时重复扫描多表 CTE 的数据库开销，卡组详情接入系统既有的每日批处理（`npm run rebuild:usage`）体系，通过数据库迁移新增两张轻量物理表，并挂载在 `usage_stat_runs` 外键下：

1. **卡组对阵 8 计数表 `stats_deck_detail_matchups`**：
   - 联合主键：`(format_id, window_start, deck_type_code, opp_deck_type_code)`
   - 存储 8 项守恒计数：`matches`, `match_wins`, `first_matches`, `first_wins`, `second_matches`, `second_wins`, `unknown_seat_matches`, `unknown_seat_wins`。
   - 包含守恒性 CHECK 约束（`matches = first + second + unknownSeat`，`match_wins = firstWins + secondWins + unknownSeatWins`）。
   - 单半年数据量固定约 930 行（30 种具名卡组 × 31 种对手）。

2. **卡组专精玩家 Top10 榜表 `stats_deck_top_players`**：
   - 联合主键：`(format_id, window_start, deck_type_code, rank)`
   - 存储：`user_id`, `username`, `matches`, `wins`, `losses`, `win_rate`（约束 `matches >= 25`，`rank BETWEEN 1 AND 10`）。
   - 单半年数据量最多约 300 行（30 种具名卡组 × 10 位达标玩家）。

3. **具名使用占比分母复用**：
   - 直接复用 `usage_deck_rows`：
     - 分子：当前卡组的 `deck_count`；
     - 分母：当前半年全部具名卡组（`deck_type_code <> 'OTHERS'`）的 `SUM(deck_count)`。
     - 保证卡组详情的使用数、占比与使用率看板完全一致。

4. **查询与发布流程**：
   - **写入时**：在每日跑批 `RebuildUsageStatisticsUseCase.rebuildFormatWindow` 事务中统一计算并写入两张表，级联随批次发布更新。
   - **读取时**：`DeckDetailPostgresRepository` 直接利用主键索引进行两次极简点查（读取 31 行对阵 + 最多 10 行玩家），查询耗时控制在 1~2 毫秒内，零运行时聚合开销。
   - 响应与页面统一展示发布快照元数据（`format`, `period`, `windowStart`, `windowEndExclusive`, `dataEndExclusive`, `publishedAt`）。

### 5. 页面与入口只携带公开选择状态

页面采用现有 HTML/CSS/原生脚本模式，增加查询、年份/上下半年选择、刷新、对阵表与 Top10，不新增同级全站 Tab。无输入时列出具名目录，搜索唯一命中后规范化 URL 为 `deckTypeCode + period`；多候选继续使用 `q + period`。无具名目录和零样本是不同状态。

请求使用递增请求序号或取消机制；改变类型/半年立即清除旧内容，成功只处理最后一次请求，并一次渲染使用占比、对阵和玩家榜。手动刷新只读 API，失败清除旧值且允许重试。名称用 `textContent` 或项目已有 HTML 转义方法，链接参数用 URL 编码，表格容器允许窄屏横向访问。

入口映射：

| 来源 | 半年选择 | 不提供链接的项 |
| --- | --- | --- |
| 使用率具名行 | 原 `period` | OTHERS、未知 |
| 矩阵行名/列名 | 原 `period` | 合计列 |
| 玩家详情半年卡组表 | 原 `season` 转成 `period` | OTHERS、未知 |
| 玩家详情总卡组表 | 当前北京时间半年，具名卡组名称超链接跳转 | OTHERS、未知 |
| 玩家详情对战记录中的具名卡组 | 该场结算时间所属北京时间半年 | 无法确认环境、OTHERS、未知 |
| 详情对手行 | 当前 `period` | unknown |
| Top10 玩家 | `scope=season&season=<period>` | 无可确认账号 |

直接非法目标保持错误语义，不因某环境无具名目录而吞掉错误并回退。“其他”只在新详情范围内排除，原榜单中的其他行保留原状。所有链接不携带密码、验证状态或完整历史授权。

备选：复制参考站的模板下载、多语言及公共资源脚本，或为此抽取全站页面框架。它们与首版统计目标无关，会扩大依赖或重构范围，均不采用。

## Risks / Trade-offs

- [实时扫描半年度事实会增加 PostgreSQL 读取负担] → 使用既有窗口、类型、物理比赛及 G1 索引，SQL 聚合并有界返回，沿用公开限流；隔离库执行代表性数据的 `EXPLAIN (ANALYZE, BUFFERS)`，有证据再单独评估索引或汇总改造。
- [历史分类与 G1 回填不完整] → 未知对手单列、未知座次仅参与综合，不在线回填；缺失本方分类无法纳入具名类型，页面明确覆盖范围。
- [新详情与旧榜单数字不同] → 展示实时查询时间、具名使用分母和排除其他说明，原页面统计不变，不拼接两种口径到一个 DTO。
- [无时区时间戳与本地进程时区混用] → 查询边界显式转换为北京时间墙钟参数，元数据时间有偏移，测试包含北京时间半年交界以及 UTC/北京时间进程设置。
- [只用 SQL 字符串断言会漏掉计数或并发错误] → 增加隔离 PostgreSQL 真数据聚合及双连接一致快照测试，不以 Mock 测试代替数据库验证。
- [相关玩家详情变更尚未归档] → 读取其现有代码与规划契约，只新增入口；不修改或归档另一变更的制品，不动其公开历史和凭据边界。

## Migration Plan

1. 实现前先创建并确认失败的领域、用例、HTTP、页面及隔离数据库行为测试，再分层完成最小实现；新增核心样本、未知分支、一致事务与 DTO 字段附中文注释。
2. 在专用 `POSTGRES_TEST_*` 隔离库验证既有迁移后的表、真实聚合、并发快照、日期边界和代表性查询计划，禁止用生产配置替代测试配置。
3. 运行 `npm run lint`、`npm run test`、隔离库 `npm run test:postgres`、`npm run check:nostalgia-resources`、`npm run build`，核对旧矩阵、使用率、玩家详情和下载回归。
4. 经后续明确发布指令，将页面、API 与三个入口随应用镜像整体发布；本变更无迁移或回填，不在规划阶段执行发布。
5. 回滚应用版本即可撤回新页面和入口；原比赛事实、统计批次、固定资源和既有接口无独立回滚步骤。
