-- Review-only PostgreSQL target DDL for the 1109 half-year Match matrix.
-- Generate a new TypeORM migration during implementation; do not execute this
-- file against production or edit previously applied migrations.
-- Reused without duplication: usage_stat_runs, usage_deck_rows, usage_card_rows.

BEGIN;

-- Each player-view duel may have a verified G1/G2/G3 index and first-turn seat.
-- Historical rows and duels that never started keep NULL; no DEFAULT false.
ALTER TABLE duels
    ADD COLUMN duel_index smallint NULL,
    ADD COLUMN is_first boolean NULL,
    ADD CONSTRAINT ck_duels_matchup_duel_index
        CHECK (duel_index IS NULL OR duel_index BETWEEN 1 AND 3),
    ADD CONSTRAINT ck_duels_matchup_first_requires_index
        CHECK (is_first IS NULL OR duel_index IS NOT NULL);

CREATE UNIQUE INDEX uq_duels_active_match_duel_index
    ON duels (match_id, duel_index)
    WHERE duel_index IS NOT NULL AND deleted_at IS NULL;

-- The existing idx_matches_usage_active_window covers the half-year date scan.
CREATE INDEX idx_matches_matchup_active_game
    ON matches (format_id, game_id)
    WHERE deleted_at IS NULL AND anulled = false;

-- One row is one physical Match: first_deck_code played first in G1.
-- A vs B and B vs A are different seat conditions. A mirror is one row.
-- Only the selected Top-15 categories may appear. No reverse player-view row,
-- ALL row, percentage, separate usage row, or Game-level result is stored.
CREATE TABLE stats_deck_matchups (
    format_id varchar(16) NOT NULL,
    window_start date NOT NULL,
    first_deck_code varchar(64) NOT NULL,
    second_deck_code varchar(64) NOT NULL,
    match_count bigint NOT NULL,
    first_wins bigint NOT NULL,
    CONSTRAINT pk_stats_deck_matchups
        PRIMARY KEY (format_id, window_start, first_deck_code, second_deck_code),
    CONSTRAINT fk_stats_deck_matchups_run
        FOREIGN KEY (format_id, window_start)
        REFERENCES usage_stat_runs (format_id, window_start),
    CONSTRAINT fk_stats_deck_matchups_first_type
        FOREIGN KEY (format_id, first_deck_code)
        REFERENCES deck_types (format_id, code),
    CONSTRAINT fk_stats_deck_matchups_second_type
        FOREIGN KEY (format_id, second_deck_code)
        REFERENCES deck_types (format_id, code),
    CONSTRAINT ck_stats_deck_matchups_format
        CHECK (format_id = '1109'),
    CONSTRAINT ck_stats_deck_matchups_named_only
        CHECK (first_deck_code <> 'OTHERS' AND second_deck_code <> 'OTHERS'),
    CONSTRAINT ck_stats_deck_matchups_counts
        CHECK (match_count > 0 AND first_wins BETWEEN 0 AND match_count)
);

CREATE INDEX idx_stats_deck_matchups_second
    ON stats_deck_matchups (format_id, window_start, second_deck_code, first_deck_code);

COMMENT ON TABLE stats_deck_matchups IS
    '仅 1109 半年度前 15 类之间的 G1 先攻卡组到后攻卡组的物理 Match 计数';

COMMIT;

-- The existing 1109 usage rebuild must select Top 15 from usage_deck_rows
-- (deck_count DESC, deck_type_code ASC, excluding OTHERS) and publish usage
-- rows, the existing usage run and matchup rows in one transaction.
-- Before publishing, verify COALESCE(SUM(match_count), 0) equals the selected
-- physical Match count and that both endpoints belong to the selected Top 15.
-- Before exposing the matrix API, rebuild every existing 1109 usage run once:
-- without a separate marker, zero matchup rows otherwise cannot distinguish
-- an old usage-only run from a successfully rebuilt zero-match period.
-- Cross-row checks are application-level; a local CHECK cannot express them.
