import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHalfYearDeckMatchups1741000003000 implements MigrationInterface {
	name = "AddHalfYearDeckMatchups1741000003000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "duels"
				ADD COLUMN "duel_index" smallint NULL,
				ADD COLUMN "is_first" boolean NULL,
				ADD CONSTRAINT "ck_duels_matchup_duel_index"
					CHECK ("duel_index" IS NULL OR "duel_index" BETWEEN 1 AND 3),
				ADD CONSTRAINT "ck_duels_matchup_first_requires_index"
					CHECK ("is_first" IS NULL OR "duel_index" IS NOT NULL)
		`);

		await queryRunner.query(`
			CREATE UNIQUE INDEX "uq_duels_active_match_duel_index"
				ON "duels" ("match_id", "duel_index")
				WHERE "duel_index" IS NOT NULL AND "deleted_at" IS NULL
		`);

		await queryRunner.query(`
			CREATE INDEX "idx_matches_matchup_active_game"
				ON "matches" ("format_id", "game_id")
				WHERE "deleted_at" IS NULL AND "anulled" = false
		`);

		await queryRunner.query(`
			CREATE TABLE "stats_deck_matchups" (
				"format_id" varchar(16) NOT NULL,
				"window_start" date NOT NULL,
				"first_deck_code" varchar(64) NOT NULL,
				"second_deck_code" varchar(64) NOT NULL,
				"match_count" bigint NOT NULL,
				"first_wins" bigint NOT NULL,
				CONSTRAINT "pk_stats_deck_matchups"
					PRIMARY KEY ("format_id", "window_start", "first_deck_code", "second_deck_code"),
				CONSTRAINT "fk_stats_deck_matchups_run"
					FOREIGN KEY ("format_id", "window_start")
					REFERENCES "usage_stat_runs" ("format_id", "window_start"),
				CONSTRAINT "fk_stats_deck_matchups_first_type"
					FOREIGN KEY ("format_id", "first_deck_code")
					REFERENCES "deck_types" ("format_id", "code"),
				CONSTRAINT "fk_stats_deck_matchups_second_type"
					FOREIGN KEY ("format_id", "second_deck_code")
					REFERENCES "deck_types" ("format_id", "code"),
				CONSTRAINT "ck_stats_deck_matchups_format"
					CHECK ("format_id" = '1109'),
				CONSTRAINT "ck_stats_deck_matchups_named_only"
					CHECK ("first_deck_code" <> 'OTHERS' AND "second_deck_code" <> 'OTHERS'),
				CONSTRAINT "ck_stats_deck_matchups_counts"
					CHECK ("match_count" > 0 AND "first_wins" BETWEEN 0 AND "match_count")
			)
		`);

		await queryRunner.query(`
			CREATE INDEX "idx_stats_deck_matchups_second"
				ON "stats_deck_matchups" ("format_id", "window_start", "second_deck_code", "first_deck_code")
		`);

		await queryRunner.query(`
			COMMENT ON TABLE "stats_deck_matchups" IS
				'仅 1109 半年度前 15 类之间的 G1 先攻卡组到后攻卡组的物理 Match 计数'
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "stats_deck_matchups"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_matches_matchup_active_game"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "uq_duels_active_match_duel_index"`);
		await queryRunner.query(`
			ALTER TABLE "duels"
				DROP CONSTRAINT IF EXISTS "ck_duels_matchup_first_requires_index",
				DROP CONSTRAINT IF EXISTS "ck_duels_matchup_duel_index",
				DROP COLUMN IF EXISTS "is_first",
				DROP COLUMN IF EXISTS "duel_index"
		`);
	}
}
