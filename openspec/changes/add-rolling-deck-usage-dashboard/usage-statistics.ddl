-- PostgreSQL schema for the 1103/1109 half-year usage statistics change.
-- Requires the existing matches table for the source index. deck_types remains
-- the application catalog for validating deck_type_code; no foreign keys are
-- declared. The actual migration is generated from TypeORM entities;
-- OpenSpec does not execute this reference DDL.
-- window_start/window_end_exclusive are fixed Beijing calendar half-year
-- boundaries. data_end_exclusive is the first Beijing day not yet included.
-- total_decks and side_known_decks are computed from eligible rows in
-- matches JOIN match_decks; usage_deck_rows is checked against that total.

BEGIN;

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

COMMIT;
