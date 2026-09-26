## Context

需求与对外行为见 `proposal.md` 和三个 `specs/`。当前 `YGOProWaitingState.handleTryStart` 在双方卡组准备完成后创建 Match；`YGOProRoom` 持有已校验的 `Deck`，但 `GameOverDomainEvent` 只携带战绩和录像。`RankedMatchPersistenceService` 已在整场 Match 结束后用一个事务写入玩家视角 `matches`、`duels`、`duel_replays` 与积分。当前录像查询以 `duel_replays` 为主表，通过任意一条 `duels` 行取昵称，尚无可靠的双方卡组关联。

线上 PostgreSQL 库是上述比赛事实与新 `match_decks` 的同一生产库。分析仓库的 `analyze_online_g1.py` 使用 `READONLY_PG_*` 只读连接且当前只查询 1109。仓库已依赖可解析 `.yrp` 的 `ygopro-yrp-encode`，生产分类和回填均可使用同一份 TypeScript 规则与固定卡池资源。

## Goals / Non-Goals

**Goals:**

- 在当前 1103/1109 排位 Match 的 G1 前确定双方初始卡组，并仅在整场结算后提交事实。
- 让环境、类型代码、Match 和录像的关联可验证；录像列表每条小局仅返回一行。
- 从线上 PostgreSQL 库安全、可中断地回填两种环境的可信历史 Main/Extra，并保持在线服务与回填任务隔离。

**Non-Goals:**

- 本变更不构建统计汇总表或新的卡组条件解释器；分类条件保留在代码中。
- 历史录像不推算 Side，也不将 G2/G3 换备版当作初始卡组。
- 不改变 `.yrp` 二进制格式、现有下载路径或排位以外的决斗流程。

## Decisions

### 1. 在排位 Match 启动时冻结领域快照

在双方通过卡组校验且 `allPlayersReady` 的 `handleTryStart` 流程中，于创建 Match 后、进入 RPS 前让房间只冻结一次双方 `Deck` 的 Main/Extra/Side 原始 `Card.code` 多重集合。快照按稳定玩家身份和队伍绑定，复制为数值数组，留在房间状态中；重连、换座和 G2/G3 换备不得修改它。正常结束与判负两条 `GAME_OVER` 路径传递同一份只读快照。未形成有效排位 Match 的房间不发布可落库快照。

备选是在每次小局启动或结算时读取 `client.deck`。该对象会被换备更新，无法证明它是 G1 前的初始卡组。

### 2. 分类器按环境路由，结果与规则版本一起保存

领域分类服务以 `format_id` 和初始 Main 为输入。1109 从本应用固定 CDB 取得 alias 关系，归一并计数，按分析仓库基线提交 `c9ba01c` 的谓词声明顺序返回首个命中类型；1103 返回本环境的 `OTHERS`。未来启用新环境时，先增加本环境目录及默认 `OTHERS` 路由。分类器输出类型代码与明确的环境规则版本；原始卡片 ID 不被归一结果覆盖。线上结算和离线回填共用这一服务。

备选是将条件存成数据库规则或只存卡片 ID 清单。现有规则含张数、集合合计、不同种类数与布尔组合；代码规则更易逐项对照和测试。

### 3. 用环境复合键约束持久化，保留现有结算事务

按 `ddl.sql` 新增 `deck_types`、`match_decks` 和 `matches(id, format_id)` 唯一键；TypeORM 实体与新生成迁移保持一致。`match_decks` 以玩家视角 `match_id` 为主键，通过 `(match_id, format_id)` 和 `(format_id, deck_type_code)` 两个复合外键分别约束所属 Match 与类型。仅种入 1109 的 25 类及 `OTHERS`、1103 的 `OTHERS`。

扩展 `RankedMatchPersistenceService` 的原有事务：先将冻结快照以稳定玩家身份对应到已解析的两位用户，再随各自 `matches` 行写入。只有两位身份与快照均可信时才写入这对在线快照；任一方无法确认时不留下单方快照，现有比赛/录像结算行为继续按原路径处理。事务失败和重复 `GAME_OVER` 沿用现有以 `game_id` 去重及重试边界。

备选是为每条 G1/G2/G3 录像各存一份快照，会重复数据并使三条下载可能不一致。

### 4. 录像列表以录像为分页单位，按玩家视角关联卡组

扩展现有 `GetReplayList`、`ReplayRepository` 和控制器。在查询环境的 `deck_types` 中验证筛选值。列表计数与分页都从 `duel_replays` 出发，用关联到 `duels.replay_id`、`duels.match_id`、`matches.id/user_id/game_id/format_id` 的 `EXISTS` 判定“任一方命中”；搜索与类型条件取交集。先分页得到唯一录像，再批量读取该页的两个玩家视角及快照，拒绝歧义、撤销、软删或跨环境的关联，不用昵称匹配身份。缺少快照时仍返回录像，类型为未知。列表只读取类型元数据，不读取 `replay_data` 或卡片数组；保持原有排序。

备选是直接将 `duel_replays` 与双方 `duels`、`matches`、`match_decks` 多行连接后分页，容易使内战录像重复并算错 `total`。

### 5. 卡组导出与页面共用环境参数

新增按 `:format`、玩家视角 `:matchId` 查询的下载用例、仓库查询和公开路由，沿用录像接口限流及 `ranking.enabled` 边界。查询核对 Match、快照和环境，按快照原始 ID 逐行构造 `#main`、`#extra`、`!side` 的 CRLF UTF-8 文件；`side_cards=NULL` 产生 `partial` 标头和文件名。安全文件名沿用现有 `.yrp` 下载的转义方式。现有 `/leaderboards/:format` 录像标签共用 `FORMAT`，从响应目录渲染筛选选项、双方类型与下载链接；用户文字只以文本节点写入。

### 6. 离线 PostgreSQL 回填使用同库的读写双连接

独立回填命令用执行环境或私有 `--env-file` 提供 `READONLY_PG_*`，以只读事务按 `format_id`、`game_id` 有界扫描 `matches`、`duels` 和 G1 `duel_replays`；写入使用本服务现有 `POSTGRES_*` TypeORM 连接。预检两组连接的目标库一致且写入权限可用，失败即停止，不输出地址、用户名、密码或连接串。预演只统计候选、跳过与失败原因；正式模式按 `game_id` 在目标库事务内幂等写入，不覆盖 `snapshot_source=online`。

使用已有 `YGOProYrp.fromYrp` 解析 G1，并以固定二进制样本人工核对 YRP1/YRP2、压缩标志、玩家顺序与 Main/Extra。只在恰有两条有效玩家视角、`duels` 与 G1 录像可无歧义关联、卡片符合对应环境资源时落库；Side 写 `NULL`。分类调用同一领域服务。该命令在在线服务之外执行，不将分析仓库、Python 或私有配置加入运行时依赖。

备选是直接运行分析仓库脚本。其当前查询只覆盖 1109，输出是分析报表，也没有本服务的同库事务与快照幂等写入流程。

## Risks / Trade-offs

- [生产库现有数据与迁移约束不兼容] → 在同版本隔离 PostgreSQL 库验证复合外键、数组、事务和新生成迁移，再执行生产迁移。
- [历史录像玩家顺序或名字不能唯一对应用户] → 固定样本核对解析结果；按 `game_id`、`replay_id`、`match_id` 与用户身份交叉验证，歧义场次跳过并计数。
- [在线事件中一方用户档案缺失] → 不写单方在线快照；现有结算路径维持，录像页面明确显示未知。
- [大批量 PostgreSQL 读取影响线上查询] → 用稳定游标、录像字节预算与小批量事务，先预演再正式运行；失败后从游标续跑。
- [公开下载包含玩家完整 Side] → 页面明示公开范围，接口限流，只返回目标玩家初始快照，响应不包含账号与连接信息。

## Migration Plan

1. 在隔离的同型数据库中生成、审查和运行新 TypeORM 迁移；确认 `ddl.sql` 与实体一致，并核对 1103/1109 目录种子与约束。
2. 生产先执行迁移，再发布可在线冻结与结算保存快照的应用；确认双环境新 Match 只在整场结算后各写两份快照，原 `.yrp` 字节不变。
3. 上线查询、下载与页面；缺失历史快照显示未知。随后用私有连接配置对 1103、1109 分别做只读预演，复核候选数、跳过原因、样本映射和目标库身份。
4. 由运维分批执行同库历史回填；每批核对双视角、Side 缺失、幂等重跑和资源占用。失败只重试未成功的 `game_id`。
5. 应用回滚保留新增表和快照数据；若某批回填需撤销，只针对有明确批次范围的 `replay_backfill` 行做经核对的清理，不影响在线快照与原始比赛/录像。
