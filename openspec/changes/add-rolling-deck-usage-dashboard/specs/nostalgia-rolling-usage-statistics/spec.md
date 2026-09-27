## Purpose

为 1103 与 1109 排位提供可重复计算的最近 90 天卡组及卡片采用量事实，并明确历史快照缺失时各榜单的样本范围，使公开使用率有可核对的分子和分母。

## ADDED Requirements

### Requirement: 以北京时间的 90 个完整自然日为唯一统计窗口

系统必须（MUST）分别为 1103 和 1109 统计任务运行日之前最近 90 个已结束的北京时间自然日，窗口为左闭右开；不得（MUST NOT）把任务运行当天尚未结束的比赛纳入。两个环境的汇总必须（MUST）保持隔离，卡组使用率与所有卡片使用率必须（MUST）使用同一个窗口。系统不得（MUST NOT）以月度 `season` 代替该滚动日期窗口。

#### Scenario: 北京时间跨日运行

- **WHEN** 任务在北京时间 2026-09-27 任意时刻运行
- **THEN** 两个环境各自统计 `[2026-06-29 00:00, 2026-09-27 00:00)` 的比赛，且 9 月 27 日的比赛不进入该次结果

#### Scenario: 窗口边界

- **WHEN** 一条比赛恰好位于窗口开始或结束时间
- **THEN** 开始时间的比赛计入，结束时间的比赛不计入

### Requirement: 以有效排位 Match 的玩家初始卡组为统计样本

系统必须（MUST）只考虑窗口内未撤销、未软删除的 1103 或 1109 排位 Match 玩家视角记录。每条有效玩家视角记录代表一份候选卡组；有可信初始卡组快照时至多贡献一份有效样本，不得（MUST NOT）按小局、录像或同一 Match 中的 Side 交换重复计数。一场双方均有快照的 Match 贡献两份卡组样本；仅一方有可信快照时，该方仍贡献一份。缺失或与环境不符的快照不得（MUST NOT）被归为“其他”。

#### Scenario: 三局 Match 与同类内战

- **WHEN** 一场三局两胜 Match 的两名玩家均有初始快照，且两人属于同一卡组类型
- **THEN** 卡组使用量增加两次，不因 G2、G3 或三条录像再增加

#### Scenario: 单方快照缺失

- **WHEN** 有效 Match 的一方存在可信初始快照，另一方没有
- **THEN** 有快照一方计入使用量与有效样本，另一方只计入候选样本数，不计入“其他”

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

### Requirement: 每项使用率公开真实样本覆盖

每个环境窗口的汇总必须（MUST）提供 `allDecks`（有效玩家视角候选数）、`validDecks`（有可信 Main、Extra 与分类的快照数）和 `sideKnownDecks`（其中初始 Side 已知的快照数）。卡组及 `monster`、`spell`、`trap`、`extra` 的使用率分母必须（MUST）为 `validDecks`；`side` 的分母必须（MUST）为 `sideKnownDecks`。历史快照的 Side 为未知时不得（MUST NOT）当作空 Side；已知的空 Side 必须（MUST）进入 Side 分母，但不产生卡片采用量。每个计数不得（MUST NOT）超过自身分母。

#### Scenario: 历史 Side 未知与已知为空

- **WHEN** 窗口内各有一份 Side 未知的历史快照和 Side 已知为空的在线快照
- **THEN** 两份均进入 `validDecks`，只有在线快照进入 `sideKnownDecks`，Side 榜无卡片采用记录

### Requirement: 使用固定的三表汇总结构

系统必须（MUST）将一次成功统计的窗口与覆盖率、卡组类型计数、卡片采用计数分别保存到下列三张 PostgreSQL 表。`window_start` 和 `window_end_exclusive` 是北京时间自然日日期，后者必须（MUST）比前者晚 90 天；`published_at` 是成功发布的实际时间。汇总表只保存整数计数，不得（MUST NOT）保存预先四舍五入的使用率或重复保存卡片名称。表结构与约束如下；实际迁移必须（MUST）由新增 TypeORM 实体生成，不得修改已应用迁移。

```sql
CREATE TABLE usage_stat_runs (
    format_id varchar(16) NOT NULL CHECK (format_id IN ('1103', '1109')),
    window_start date NOT NULL,
    window_end_exclusive date NOT NULL,
    published_at timestamptz NOT NULL,
    all_decks bigint NOT NULL CHECK (all_decks >= 0),
    valid_decks bigint NOT NULL CHECK (valid_decks >= 0 AND valid_decks <= all_decks),
    side_known_decks bigint NOT NULL
        CHECK (side_known_decks >= 0 AND side_known_decks <= valid_decks),
    PRIMARY KEY (format_id, window_end_exclusive),
    CHECK (window_end_exclusive = window_start + 90)
);

CREATE TABLE usage_deck_rows (
    format_id varchar(16) NOT NULL,
    window_end_exclusive date NOT NULL,
    deck_type_code varchar(64) NOT NULL,
    deck_count bigint NOT NULL CHECK (deck_count > 0),
    PRIMARY KEY (format_id, window_end_exclusive, deck_type_code),
    FOREIGN KEY (format_id, window_end_exclusive)
        REFERENCES usage_stat_runs (format_id, window_end_exclusive) ON DELETE CASCADE,
    FOREIGN KEY (format_id, deck_type_code)
        REFERENCES deck_types (format_id, code)
);

CREATE TABLE usage_card_rows (
    format_id varchar(16) NOT NULL,
    window_end_exclusive date NOT NULL,
    metric varchar(16) NOT NULL
        CHECK (metric IN ('monster', 'spell', 'trap', 'extra', 'side')),
    card_id integer NOT NULL CHECK (card_id > 0),
    deck_count bigint NOT NULL CHECK (deck_count > 0),
    copies_1 bigint NOT NULL CHECK (copies_1 >= 0),
    copies_2 bigint NOT NULL CHECK (copies_2 >= 0),
    copies_3 bigint NOT NULL CHECK (copies_3 >= 0),
    PRIMARY KEY (format_id, window_end_exclusive, metric, card_id),
    FOREIGN KEY (format_id, window_end_exclusive)
        REFERENCES usage_stat_runs (format_id, window_end_exclusive) ON DELETE CASCADE,
    CHECK (copies_1 + copies_2 + copies_3 = deck_count)
);

CREATE INDEX idx_usage_deck_rows_rank
    ON usage_deck_rows (format_id, window_end_exclusive, deck_count DESC, deck_type_code);
CREATE INDEX idx_usage_card_rows_rank
    ON usage_card_rows (format_id, window_end_exclusive, metric, deck_count DESC, card_id);
CREATE INDEX idx_matches_usage_active_window
    ON matches (format_id, date, id)
    WHERE deleted_at IS NULL AND anulled = false;
```

零次采用的类别或卡片不插入子表；没有比赛的窗口仍必须（MUST）有一行三个覆盖计数均为零的 `usage_stat_runs`。跨表的 `SUM(usage_deck_rows.deck_count) = usage_stat_runs.valid_decks`、卡片采用量不超过对应分母，以及卡片 ID 属于固定资源，由任务在发布前核对，不能（MUST NOT）把这些跨表或跨数据库关系伪装成单行 `CHECK` 约束。

#### Scenario: 两个环境的同一天窗口

- **WHEN** 1103 和 1109 都成功发布以同一天为结束日期的窗口
- **THEN** `usage_stat_runs` 有两条由 `format_id` 区分的记录，子表只引用各自环境的窗口，卡组类型外键也不能跨环境匹配

#### Scenario: 非法计数无法落库

- **WHEN** 写入负数覆盖、超过有效样本数的 Side 分母，或投入三个桶之和不等于采用量的卡片行
- **THEN** 数据库约束拒绝该写入，不发布不完整的统计结果

### Requirement: 每日任务可重建且发布原子

系统必须（MUST）提供由宿主 crontab 按北京时间每天计划调用一次的一次性统计任务，为两个环境重建当前 90 天窗口；应用启动与在线对局结算不得（MUST NOT）额外触发该全量任务。人工重跑允许使用同一命令。相同窗口重复执行不得（MUST NOT）累加或重复发布数量；并发执行不得（MUST NOT）产生相互覆盖的部分结果。只有某环境的覆盖计数、卡组计数和全部卡片指标均成功计算并通过一致性检查后，才能（MUST）发布该环境新窗口；失败时必须（MUST）保留该环境上一次成功结果并以非零状态报告失败。窗口内迟到的可信快照或撤销比赛必须（MUST）在下一次成功重建后反映出来。

#### Scenario: 每天一次计划执行

- **WHEN** 宿主 crontab 在北京时间新的一天触发统计命令
- **THEN** 命令各为 1103 与 1109 重建一个相同日期范围的窗口，服务启动和页面访问不额外启动统计计算

#### Scenario: 重复执行同一窗口

- **WHEN** 运维对同一天的 90 天窗口连续运行任务两次且源数据未改变
- **THEN** 对外计数与使用率相同，不出现双倍统计

#### Scenario: 重建中途失败

- **WHEN** 某环境的卡片汇总失败，而该环境已有上次成功结果
- **THEN** 对外仍可读取完整的上次成功窗口与更新时间，不出现新旧指标混合

#### Scenario: 空窗口

- **WHEN** 某环境的 90 天窗口没有有效排位 Match
- **THEN** 任务仍发布窗口与三个零覆盖计数，所有榜单为空
