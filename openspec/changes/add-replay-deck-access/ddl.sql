-- PostgreSQL schema for replay deck access in the enabled formats.
-- Requires the existing matches(id character varying primary key, format_id character varying) table.
-- This reviewed SQL is a reference for a new TypeORM migration; it is not run by OpenSpec.
-- Only the two fact/catalog tables needed by replay deck access are defined here.

BEGIN;

CREATE TABLE deck_types (
    format_id varchar(16) NOT NULL,
    code varchar(64) NOT NULL,
    name_zh varchar(64) NOT NULL,
    sort_order integer NOT NULL,
    CONSTRAINT pk_deck_types PRIMARY KEY (format_id, code),
    CONSTRAINT uq_deck_types_format_sort UNIQUE (format_id, sort_order),
    CONSTRAINT ck_deck_types_sort_order CHECK (sort_order >= 0)
);

-- The additional unique key lets the snapshot's format match its parent Match.
ALTER TABLE matches ADD CONSTRAINT uq_matches_id_format UNIQUE (id, format_id);

CREATE TABLE match_decks (
    match_id varchar PRIMARY KEY,
    format_id varchar(16) NOT NULL,
    deck_type_code varchar(64) NOT NULL,
    classifier_version varchar(64) NOT NULL,
    snapshot_source varchar(16) NOT NULL,
    main_cards integer[] NOT NULL,
    extra_cards integer[] NOT NULL,
    side_cards integer[] NULL,
    CONSTRAINT fk_match_decks_match
        FOREIGN KEY (match_id, format_id) REFERENCES matches(id, format_id),
    CONSTRAINT fk_match_decks_type
        FOREIGN KEY (format_id, deck_type_code) REFERENCES deck_types(format_id, code),
    CONSTRAINT ck_match_decks_source
        CHECK (snapshot_source IN ('online', 'replay_backfill')),
    CONSTRAINT ck_match_decks_main_count
        CHECK (cardinality(main_cards) BETWEEN 40 AND 60),
    CONSTRAINT ck_match_decks_extra_count
        CHECK (cardinality(extra_cards) BETWEEN 0 AND 15),
    CONSTRAINT ck_match_decks_side_count
        CHECK (side_cards IS NULL OR cardinality(side_cards) BETWEEN 0 AND 15)
);

CREATE INDEX idx_match_decks_type_match
    ON match_decks (format_id, deck_type_code, match_id);

-- 1109 sort_order follows SUPPORTED_CATEGORIES. Enabled formats without
-- named rules seed OTHERS; a missing match_decks row means unknown.
INSERT INTO deck_types (format_id, code, name_zh, sort_order) VALUES
    ('1103', 'OTHERS', '其他', 0),
    ('1109', 'D01', '代行天使', 0),
    ('1109', 'D02', 'HB', 1),
    ('1109', 'D03', '导游兔', 2),
    ('1109', 'D04', '血代齿轮', 3),
    ('1109', 'D05', '龙骑兵团', 4),
    ('1109', 'D06', '废二', 5),
    ('1109', 'D07', '暗黑界', 6),
    ('1109', 'D08', '天狗植物', 7),
    ('1109', 'D09', '熔岩', 8),
    ('1109', 'D10', '混沌均', 9),
    ('1109', 'D11', '光道', 10),
    ('1109', 'D12', '蛙帝', 11),
    ('1109', 'D13', '废铁', 12),
    ('1109', 'D14', '永火', 13),
    ('1109', 'D15', 'X剑士', 14),
    ('1109', 'D16', '遗式', 15),
    ('1109', 'D17', '守墓', 16),
    ('1109', 'D18', '黑羽', 17),
    ('1109', 'D19', '剑斗兽', 18),
    ('1109', 'D20', '六武众', 19),
    ('1109', 'D21', '变形斗士', 20),
    ('1109', 'D22', '科技属', 21),
    ('1109', 'D23', '削血', 22),
    ('1109', 'D24', '机巧', 23),
    ('1109', 'D25', '水泡英雄', 24),
    ('1109', 'OTHERS', '其他', 25);

COMMIT;
