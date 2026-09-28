# nostalgia-rolling-usage-statistics Specification

## Purpose

为 1103 与 1109 排位提供按北京时间自然半年归属、可重复计算的卡组及卡片采用量事实，并明确历史快照缺失时各榜单的样本范围，使公开使用率有可核对的分子和分母。

## Requirements

### Requirement: 按北京时间自然半年划分统计窗口

系统必须（MUST）分别为 1103 和 1109 按北京时间自然半年统计：`YYYYH1` 的固定边界为当年 1 月 1 日 00:00 至 7 月 1 日 00:00，`YYYYH2` 为当年 7 月 1 日 00:00 至次年 1 月 1 日 00:00，均左闭右开。当前半年度每天只统计至运行日 00:00，已结束半年度统计至其固定结束边界；不得（MUST NOT）纳入边界外或任务当天尚未结束的比赛。两个环境必须（MUST）隔离，六个榜单必须（MUST）使用相同的半年归属和实际统计截止日。系统不得（MUST NOT）以最近 90 天、服务器本地时区或排位 Match 的月度 `season` 字段替代半年日期范围。

#### Scenario: 当前下半年每日重建

- **WHEN** 任务在北京时间 2026-09-27 任意时刻运行
- **THEN** 两个环境的 `2026H2` 各自统计 `[2026-07-01 00:00, 2026-09-27 00:00)` 的比赛，且 6 月 30 日及 9 月 27 日的比赛均不进入该次结果

#### Scenario: 上半年最终结果

- **WHEN** `2026H1` 在 2026 年 7 月 1 日或之后完成最终重建
- **THEN** 只统计 `[2026-01-01 00:00, 2026-07-01 00:00)`，包括 6 月 30 日的比赛，不包括 7 月 1 日的比赛

#### Scenario: 窗口边界

- **WHEN** 一条比赛恰好位于窗口开始或结束时间
- **THEN** 开始时间的比赛计入，结束时间的比赛不计入

### Requirement: 以有效排位 Match 的玩家初始卡组为统计样本

系统必须（MUST）只考虑窗口内未撤销、未软删除的 1103 或 1109 排位 Match 玩家视角记录，且仅将其中有可信初始 Main、Extra 与环境内分类结果的快照计为卡组样本。每条记录至多贡献一份样本，不得（MUST NOT）按小局、录像或同一 Match 中的 Side 交换重复计数。一场双方均有可信快照的 Match 贡献两份卡组样本；仅一方有可信快照时，该方仍贡献一份。缺失或与环境不符的快照不得（MUST NOT）进入分母或归为“其他”。

#### Scenario: 三局 Match 与同类内战

- **WHEN** 一场三局两胜 Match 的两名玩家均有初始快照，且两人属于同一卡组类型
- **THEN** 卡组使用量增加两次，不因 G2、G3 或三条录像再增加

#### Scenario: 单方快照缺失

- **WHEN** 有效 Match 的一方存在可信初始快照，另一方没有
- **THEN** 有快照一方计入使用量与 `totalDecks`，另一方不进入任何榜单分母，也不计入“其他”

#### Scenario: 撤销或软删除

- **WHEN** 原已统计的比赛在下一次重建前被撤销或软删除
- **THEN** 下一次成功汇总不再包含该比赛的双方玩家视角样本

### Requirement: 按环境统计卡组类型使用率

系统必须（MUST）使用初始快照中已记录的环境内分类结果统计卡组类型，包含 `OTHERS`。1109 使用其现有 25 个具名类型和 `OTHERS`；1103 在本变更中沿用现有分类，所有可信快照均计入 1103 的 `OTHERS`。某类型的使用率必须（MUST）等于该类型的样本数除以该环境窗口内有效初始卡组样本数；所有类型的样本数之和必须（MUST）等于有效初始卡组样本数。分母为零时使用率必须（MUST）表示为未知，不能（MUST NOT）伪造为 0% 或 100%。

#### Scenario: 1103 只有“其他”

- **WHEN** 1103 窗口内有可信卡组快照
- **THEN** 卡组类型榜仅有“其他”，其数量等于有效快照数，使用率为 100%

#### Scenario: 1109 未命中具名规则

- **WHEN** 1109 的可信卡组已分类为 `OTHERS`
- **THEN** 它进入 1109 的“其他”数量及有效分母，不被当作缺失快照

### Requirement: 按卡槽与固定资源统计卡片采用量

系统必须（MUST）提供 `monster`、`spell`、`trap`、`extra`、`side` 五种卡片指标。前三种只取初始 Main 并按固定卡片数据的类型分别归类；`extra` 只取初始 Extra；`side` 只取初始 Side，且不再按怪兽、魔法、陷阱拆分。系统必须（MUST）按固定卡片数据的 alias 链将异画码归一为同一卡片，在同一快照的同一卡槽内合并张数。同一归一卡每份卡组每项指标只增加一次采用量，且按合并后的张数恰好进入投入 1、2、3 张中的一个桶；三个桶之和必须（MUST）等于该卡的采用量。不同环境不得（MUST NOT）混合计数。

#### Scenario: 异画码和重复张数

- **WHEN** 一份 Main 中有指向同一原卡的两个异画码和一张原卡
- **THEN** 对应卡片的 Main 类型指标采用量增加 1，投入 3 张桶增加 1，其他投入桶不增加

#### Scenario: Main 与 Side 各有同一卡

- **WHEN** 一份完整初始快照的 Main 与 Side 都含有同一张卡
- **THEN** Main 对应类型指标和 Side 指标分别统计，不把两个卡槽的张数相加

### Requirement: 每项使用率公开真实样本分母

每个环境窗口的汇总必须（MUST）提供 `totalDecks`（可信初始快照的卡组份数）和 `sideKnownDecks`（其中初始 Side 已知的快照数）。两个计数必须（MUST）从同一窗口内有效 `matches` 关联的 `match_decks` 可信快照逐份计算，与卡组及卡片明细在同一次统计中发布；不得（MUST NOT）从已汇总的卡组榜反推或从全部 `matches` 行直接计数。卡组及 `monster`、`spell`、`trap`、`extra` 的使用率分母必须（MUST）为 `totalDecks`；`side` 的分母必须（MUST）为 `sideKnownDecks`。没有可信快照的比赛不得（MUST NOT）进入任何分母；历史快照的 Side 为未知时不得（MUST NOT）当作空 Side；已知的空 Side 必须（MUST）进入 Side 分母，但不产生卡片采用量。每个计数不得（MUST NOT）超过自身分母。

#### Scenario: 历史 Side 未知与已知为空

- **WHEN** 窗口内各有一份 Side 未知的历史快照和 Side 已知为空的在线快照
- **THEN** 两份均进入 `totalDecks`，只有在线快照进入 `sideKnownDecks`，Side 榜无卡片采用记录

### Requirement: 使用固定的三表汇总结构

系统必须（MUST）将每个环境、每个半年度的样本总数、卡组类型计数、卡片采用计数分别保存到下列三张 PostgreSQL 表。`window_start` 和 `window_end_exclusive` 是该半年度固定的北京时间日期边界；`data_end_exclusive` 是本次实际统计的截止日期，当前半年度可早于固定结束边界；`published_at` 是成功发布的实际时间。汇总表只保存整数计数，不得（MUST NOT）保存预先四舍五入的使用率或重复保存卡片名称。表结构与约束如下，同内容的独立文件见 [usage-statistics.ddl](../../usage-statistics.ddl)；实际迁移必须（MUST）由新增 TypeORM 实体生成，不得修改已应用迁移。

三张统计表不得（MUST NOT）定义数据库外键。统计任务必须（MUST）在发布前验证每条明细的环境与半年键等于汇总头记录，并验证卡组类型代码属于对应环境的 `deck_types` 目录；整批结果必须（MUST）在同一事务中发布或回滚。删除某半年度汇总时必须（MUST）显式删除其两张明细表中的对应行。

```sql
CREATE TABLE usage_stat_runs (
    format_id varchar(16) NOT NULL CHECK (format_id IN ('1103', '1109')),
    window_start date NOT NULL,
    window_end_exclusive date NOT NULL,
    data_end_exclusive date NOT NULL,
    published_at timestamptz NOT NULL,
    total_decks bigint NOT NULL CHECK (total_decks >= 0),
    side_known_decks bigint NOT NULL
        CHECK (side_known_decks >= 0 AND side_known_decks <= total_decks),
    PRIMARY KEY (format_id, window_start),
    CHECK (EXTRACT(DAY FROM window_start) = 1
        AND EXTRACT(MONTH FROM window_start) IN (1, 7)),
    CHECK (window_end_exclusive = (window_start + INTERVAL '6 months')::date),
    CHECK (data_end_exclusive BETWEEN window_start AND window_end_exclusive)
);

CREATE TABLE usage_deck_rows (
    format_id varchar(16) NOT NULL CHECK (format_id IN ('1103', '1109')),
    window_start date NOT NULL,
    deck_type_code varchar(64) NOT NULL,
    deck_count bigint NOT NULL CHECK (deck_count > 0),
    PRIMARY KEY (format_id, window_start, deck_type_code),
    CHECK (EXTRACT(DAY FROM window_start) = 1
        AND EXTRACT(MONTH FROM window_start) IN (1, 7))
);

CREATE TABLE usage_card_rows (
    format_id varchar(16) NOT NULL CHECK (format_id IN ('1103', '1109')),
    window_start date NOT NULL,
    metric varchar(16) NOT NULL
        CHECK (metric IN ('monster', 'spell', 'trap', 'extra', 'side')),
    card_id integer NOT NULL CHECK (card_id > 0),
    deck_count bigint NOT NULL CHECK (deck_count > 0),
    copies_1 bigint NOT NULL CHECK (copies_1 >= 0),
    copies_2 bigint NOT NULL CHECK (copies_2 >= 0),
    copies_3 bigint NOT NULL CHECK (copies_3 >= 0),
    PRIMARY KEY (format_id, window_start, metric, card_id),
    CHECK (EXTRACT(DAY FROM window_start) = 1
        AND EXTRACT(MONTH FROM window_start) IN (1, 7)),
    CHECK (copies_1 + copies_2 + copies_3 = deck_count)
);

COMMENT ON TABLE usage_stat_runs IS '按赛制和自然半年保存一次完整发布的使用率统计及样本覆盖';
COMMENT ON COLUMN usage_stat_runs.format_id IS '赛制编号，仅 1103 或 1109；两个环境独立统计';
COMMENT ON COLUMN usage_stat_runs.window_start IS '所属自然半年的北京时间开始日期，包含当天；上半年为 1 月 1 日，下半年为 7 月 1 日';
COMMENT ON COLUMN usage_stat_runs.window_end_exclusive IS '所属自然半年的北京时间固定结束日期，不包含当天；上半年为 7 月 1 日，下半年为次年 1 月 1 日';
COMMENT ON COLUMN usage_stat_runs.data_end_exclusive IS '本次汇总实际覆盖到的北京时间截止日期，不包含当天；当前半年通常为任务运行日';
COMMENT ON COLUMN usage_stat_runs.published_at IS '本行及其卡组、卡片明细最近一次完整成功发布的时间';
COMMENT ON COLUMN usage_stat_runs.total_decks IS '从有效 matches 关联的可信 match_decks 快照计算的卡组份数；卡组榜及非 Side 卡片榜的分母';
COMMENT ON COLUMN usage_stat_runs.side_known_decks IS '上述可信 match_decks 中 side_cards 非 NULL 的份数，空数组也计入；Side 卡片榜的分母';

COMMENT ON TABLE usage_deck_rows IS '每个环境、自然半年和卡组类型的使用份数';
COMMENT ON COLUMN usage_deck_rows.format_id IS '赛制编号，与汇总批次及卡组类型目录的环境一致';
COMMENT ON COLUMN usage_deck_rows.window_start IS '所属自然半年的北京时间开始日期，与 usage_stat_runs 共同定位汇总批次';
COMMENT ON COLUMN usage_deck_rows.deck_type_code IS '环境内卡组分类代码，由统计任务对照 deck_types 目录校验，包含 OTHERS';
COMMENT ON COLUMN usage_deck_rows.deck_count IS '有效初始卡组快照中被分为该类型的卡组份数，每份卡组只计一次';

COMMENT ON TABLE usage_card_rows IS '每个环境、自然半年、卡片指标和归一卡片的采用份数及投入张数分布';
COMMENT ON COLUMN usage_card_rows.format_id IS '赛制编号，与汇总批次的环境一致';
COMMENT ON COLUMN usage_card_rows.window_start IS '所属自然半年的北京时间开始日期，与 usage_stat_runs 共同定位汇总批次';
COMMENT ON COLUMN usage_card_rows.metric IS '卡片指标：monster、spell、trap 取初始 Main，extra 取初始 Extra，side 取初始 Side';
COMMENT ON COLUMN usage_card_rows.card_id IS '按固定卡片数据库的 alias 链归一后的卡片 ID';
COMMENT ON COLUMN usage_card_rows.deck_count IS '该指标中采用此卡的卡组份数，同一卡在一份卡组内只计一次';
COMMENT ON COLUMN usage_card_rows.copies_1 IS '该指标中归一后恰好投入此卡 1 张的卡组份数';
COMMENT ON COLUMN usage_card_rows.copies_2 IS '该指标中归一后恰好投入此卡 2 张的卡组份数';
COMMENT ON COLUMN usage_card_rows.copies_3 IS '该指标中归一后恰好投入此卡 3 张的卡组份数';

CREATE INDEX idx_usage_deck_rows_rank
    ON usage_deck_rows (format_id, window_start, deck_count DESC, deck_type_code);
CREATE INDEX idx_usage_card_rows_rank
    ON usage_card_rows (format_id, window_start, metric, deck_count DESC, card_id);
CREATE INDEX idx_matches_usage_active_window
    ON matches (format_id, date, id)
    WHERE deleted_at IS NULL AND anulled = false;
```

零次采用的类别或卡片不插入子表；没有可信快照的窗口仍必须（MUST）有一行两个样本计数均为零的 `usage_stat_runs`。跨表的 `SUM(usage_deck_rows.deck_count) = usage_stat_runs.total_decks`、明细与汇总头的键一致、卡组类型属于对应环境、卡片采用量不超过对应分母，以及卡片 ID 属于固定资源，由任务在发布前核对，不能（MUST NOT）把这些跨表或跨数据库关系伪装成单行 `CHECK` 约束。

#### Scenario: 两个环境的同一半年度

- **WHEN** 1103 和 1109 都成功发布 `2026H2` 的结果
- **THEN** `usage_stat_runs` 有两条 `window_start=2026-07-01` 且由 `format_id` 区分的记录，统计任务只发布各自环境的明细和有效分类

#### Scenario: 明细归属或类型不合法

- **WHEN** 待发布的明细环境或半年键与汇总头不一致，或卡组类型代码不属于该环境
- **THEN** 统计任务拒绝该环境整批结果并保留上次成功结果，不依赖数据库外键检查

#### Scenario: 非法计数无法落库

- **WHEN** 写入负数覆盖、超过有效样本数的 Side 分母，或投入三个桶之和不等于采用量的卡片行
- **THEN** 数据库约束拒绝该写入，不发布不完整的统计结果

### Requirement: 每日任务可重建且发布原子

系统必须（MUST）提供由宿主 crontab 按北京时间每天计划调用一次的一次性统计任务，为两个环境重建当前半年度；换期后还必须（MUST）重建上一半年度，直到该半年度成功发布 `data_end_exclusive=window_end_exclusive` 的最终结果。应用启动与在线对局结算不得（MUST NOT）额外触发全量任务。人工重跑必须（MUST）支持指定 `YYYYH1` 或 `YYYYH2`，用于历史回填与修正。相同半年度重复执行不得（MUST NOT）累加数量；并发执行不得（MUST NOT）产生相互覆盖的部分结果。只有某环境的覆盖计数、卡组计数和全部卡片指标均成功计算并通过一致性检查后，才能（MUST）发布该环境新结果；失败时必须（MUST）保留该环境上一次成功结果并以非零状态报告失败。当前半年度内迟到的可信快照或撤销比赛必须（MUST）在下一次成功重建后反映；已结束半年度的修正由人工重建反映。

#### Scenario: 每天一次计划执行

- **WHEN** 宿主 crontab 在北京时间新的一天触发统计命令
- **THEN** 命令各为 1103 与 1109 重建当前半年度截至前一日的窗口；若上一半年度尚未最终发布，同一次命令还补齐上一半年度，服务启动和页面访问不额外启动统计计算

#### Scenario: 重复执行同一窗口

- **WHEN** 运维对同一半年度相同截止日连续运行任务两次且源数据未改变
- **THEN** 对外计数与使用率相同，不出现双倍统计

#### Scenario: 重建中途失败

- **WHEN** 某环境的卡片汇总失败，而该环境已有上次成功结果
- **THEN** 对外仍可读取该半年度完整的上次成功结果与更新时间，不出现新旧指标混合

#### Scenario: 没有可信快照的窗口

- **WHEN** 某环境的当前半年度截至统计日没有可信初始卡组快照，包括比赛记录存在但快照均缺失的情况
- **THEN** 任务仍发布窗口与两个零样本计数，所有榜单为空
