## Context

动机与范围见 [proposal.md](./proposal.md)，行为口径见本变更的两个增量 spec。[参考页面](http://121.4.34.71:7922/usage-stats.html?metric=monster&period=month&month=202609&page=1)只作为六标签、表格和投入张数展示的参考，不作为分类或数据源。现有 `matches` 是排位 Match 的玩家视角事实，`match_decks` 以玩家视角 Match ID 保存 G1 前 Main、Extra、Side；历史回填的 `side_cards` 可以为 `NULL`。1109 已有 25 类加 `OTHERS`，1103 目前只有 `OTHERS`。生产镜像包含编译后的 `dist` 与固定 `nostalgia-resources`，云端以 Docker Compose 运行 PostgreSQL 与服务。`matches.date` 的数据库类型是无时区 `TIMESTAMP`，而窗口必须按北京时间划分。

## Goals / Non-Goals

**Goals:**

- 让统计计算离开在线 Match 结算路径，公开查询只读已发布的汇总。
- 保持一份快照对应一个玩家 Match 样本，确保六个榜单的分子、分母和覆盖率可以复算。
- 让一次失败或重跑不破坏用户当前能看到的完整结果。

**Non-Goals:**

- 不引入新分类规则、逐卡事实明细表、实时更新或对阵/胜率计算。
- 不以参考站的分类 ID、外部 API 或运行时资源作为本服务事实来源。

## Decisions

### 1. 以完整北京时间日期确定窗口，并先验证 `matches.date` 的实际语义

任务在运行时确定北京时间当天 00:00 为 `endExclusive`，向前减 90 个自然日得 `start`，然后对 `matches.date` 使用左闭右开范围；不使用 `matches.season`。实现前用真实 PostgreSQL 映射与固定边界样本验证 `Date` 写入、读回和查询在北京时间午夜前后的行为，并抽样核对现有数据。若发现无时区列的写入语义不一致，先通过独立的增量迁移或经验证的转换路径修正时间事实，再发布汇总；不靠服务器本地时区猜测历史记录。

备选是按最近三个 `season` 聚合，无法表示连续 90 天；按服务器时区截取 `date` 则会使部署环境影响样本边界。

### 2. 从玩家视角快照全量重建，不在结算事务内增量加计数

每日任务只扫描有效 `matches`，以 Match ID 关联 `match_decks`，并检查环境一致、快照完整性及分类目录存在性。用有界的 `(date, id)` 游标和一致的数据库读取快照，按环境逐一累加到内存中的卡组类别与卡片 ID 计数；内存规模由固定卡池和类别目录约束。`allDecks` 包括有效 Match 玩家视角行；`validDecks` 只包括可信 Main、Extra 与分类的快照；`sideKnownDecks` 只包括其中 `side_cards IS NOT NULL` 的快照。单方记录或快照缺失不阻断另一方的使用量。任务报告各类缺口与异常，但不读取录像二进制。

卡片适配器只读取应用内固定 `cards.cdb` 的 ID、alias、类型和名称。领域计算器按 alias 链归一，按原始卡槽分别统计；Main 卡只进入其唯一的怪兽、魔法或陷阱类别，Extra 与 Side 各自独立。已有分类结果用于卡组榜，1103 的 `OTHERS` 不重新解释。发布前校验 `sum(deck_count)=validDecks`、`sideKnownDecks<=validDecks<=allDecks`、每张卡 `copies1+copies2+copies3=deckCount` 及采用量不超过对应分母。

备选是每场结算时更新汇总，虽然读取较快，却难以处理撤销、迟到回填和滚动窗口到期，也会增加在线事务负担。逐卡事实表会复制快照已有的数据并显著增加行数。

### 3. 用窗口级汇总表和短事务发布完整结果

三张可重建表的字段、类型、主外键、`CHECK` 与排序索引以 [统计 spec](./specs/nostalgia-rolling-usage-statistics/spec.md) 中的完整 SQL 结构为准；迁移由 TypeORM 实体生成。这里采用环境与窗口结束日期组成自然键，不额外引入 `run_id`：

| 表 | 建议唯一粒度 | 内容 |
| --- | --- | --- |
| `usage_stat_runs` | `(format_id, window_end_exclusive)` | 窗口起止、成功发布时间及三个覆盖计数 |
| `usage_deck_rows` | `(format_id, window_end_exclusive, deck_type_code)` | 卡组类型使用数，复合外键约束对应环境与类型 |
| `usage_card_rows` | `(format_id, window_end_exclusive, metric, card_id)` | 卡片采用数与投入 1/2/3 张分布 |

每个环境先独立完成计算和校验，再在一个短事务中删除同窗口旧子行、插入或更新父行的覆盖计数与 `published_at`，随后写入新子行；失败则回滚到上次成功结果。查询只选该环境最新已提交的窗口，并在一次一致读取中取得元数据与分页行；保留每环境最近两个成功窗口，只有新窗口成功提交后才清理更旧的可重建汇总。任务对每个环境获取 PostgreSQL advisory lock，防止多个 crontab 或人工重跑并发写入；同窗口重跑是覆盖而非累加。一个环境失败不阻止另一个环境尝试重建，但整个命令返回非零状态。

备选是在同一张表原地逐行更新，会让读取中途看到混合窗口；为每天保留永久的完整快照则增加无用存储。汇总表只保存原始整数计数，百分比由查询层现算。

### 4. 一次性 CLI 由宿主 crontab 驱动

在 `src/shared/stats/` 下按领域计算、应用编排、PostgreSQL/CDB 适配器分层；单独的 CLI 入口随 TypeScript 构建进入生产镜像。宿主 crontab 在已核对为北京时间的调度环境中每天 03:10 只安排一次现有 Compose 配置下的一次性镜像命令，复用与服务相同的数据库环境和固定资源；应用启动或 Socket 构造时不注册定时器。CLI 记录每环境的窗口、覆盖、耗时与失败类别并以退出码供 cron 监控，不打印数据库凭据。部署文档给出使用绝对路径的 crontab 配置、时区核对、同命令的人工重跑及重复安装检查方式。

备选是在服务进程内使用定时器，会在多实例和重启时增加重复执行及漏跑风险，也不符合要求的 crontab 调度方式。

### 5. 页面只查询已发布汇总

新增 `/api/ladder/:format/usage`：必填 `metric`，可选 `page` 与 `pageSize`；统一返回环境、指标、窗口、`updatedAt`、覆盖、分母、总数和页码。`metric=deck` 使用 `decks` 列表，其他指标使用 `cards` 列表。计数降序，卡组代码或卡片 ID 升序打破并列；查询服务按分母计算 0–1 比例，分母为零返回 `null`。名称来自本镜像固定 CDB；缺少名称时保留卡片 ID 供辨识。接口沿用排位开关与已有公开 API 的限流方式，拒绝无效环境/参数，不公开玩家身份或原始卡组。

新增自包含的 `/leaderboards/:format/usage` 页面并在现有决斗专区加入入口。页面从 URL 恢复指标与页码，六个标签共用一份 90 天窗口，展示覆盖、真实起止日期、更新时间和旧数据提示。无汇总时显示“尚未生成”，成功的零样本结果显示“暂无统计数据”；手动刷新只重取 API，不执行聚合。

备选是每次打开页面时扫描 90 天源表，数据库负担和响应时间会随对局量增长，也无法保证玩家看到同一个发布批次。

## Risks / Trade-offs

- `[无时区历史时间不一致]` → 先做午夜边界的 PostgreSQL 集成验证与现有数据抽样；确认转换语义后再写窗口查询，必要时先做增量时间字段迁移。
- `[历史快照及 Side 覆盖不足]` → 页面始终展示 `allDecks`、`validDecks` 与 `sideKnownDecks`，不把 `NULL` 当空数组；历史回填可在下一次重建后自动反映。
- `[90 天扫描耗时或影响线上库]` → 使用范围索引与有界游标，避免读取 `replay_data`，在接近生产数据量时检查 `EXPLAIN`、耗时和内存，再调整批量大小。
- `[分类或固定资源未来升级]` → 汇总仅消费经版本管理的快照与本镜像固定 CDB；分类行为变更必须先按既有规则显式重分类受影响快照，再重建窗口。

## Migration Plan

1. 先确认 `add-replay-deck-access` 的迁移与在线采集已应用；历史回填可继续进行，但发布前核对两环境覆盖率和 Side 已知比例。
2. 通过新 TypeORM 实体生成并审阅汇总表与查询索引迁移；在隔离 PostgreSQL 中验证迁移、午夜边界、重跑和失败回滚。
3. 发布包含 CLI、API、页面和固定资源的同一镜像；先人工运行一次任务并核对六类计数、时间窗口、1103 的“其他”及页面反馈，再配置每日 crontab。
4. 回滚时停止 crontab 并回滚应用镜像；保留可重建汇总表和原始 Match 快照，不修改已应用的历史迁移或删除事实数据。
