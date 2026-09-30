import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 迁移：新增卡组详情预聚合物理表
 * 包含 stats_deck_detail_matchups（全对手 8 计数守恒汇总）与 stats_deck_top_players（专精玩家胜率 Top10 榜）
 */
export class AddDeckDetailPrecomputedTables1790619192716 implements MigrationInterface {
	name = "AddDeckDetailPrecomputedTables1790619192716";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "stats_deck_detail_matchups" (
				"format_id" varchar(16) NOT NULL CHECK ("format_id" = '1109'),
				"window_start" date NOT NULL,
				"deck_type_code" varchar(64) NOT NULL,
				"opp_deck_type_code" varchar(64) NOT NULL,
				"matches" bigint NOT NULL DEFAULT 0 CHECK ("matches" >= 0),
				"match_wins" bigint NOT NULL DEFAULT 0 CHECK ("match_wins" >= 0 AND "match_wins" <= "matches"),
				"first_matches" bigint NOT NULL DEFAULT 0 CHECK ("first_matches" >= 0),
				"first_wins" bigint NOT NULL DEFAULT 0 CHECK ("first_wins" >= 0 AND "first_wins" <= "first_matches"),
				"second_matches" bigint NOT NULL DEFAULT 0 CHECK ("second_matches" >= 0),
				"second_wins" bigint NOT NULL DEFAULT 0 CHECK ("second_wins" >= 0 AND "second_wins" <= "second_matches"),
				"unknown_seat_matches" bigint NOT NULL DEFAULT 0 CHECK ("unknown_seat_matches" >= 0),
				"unknown_seat_wins" bigint NOT NULL DEFAULT 0 CHECK ("unknown_seat_wins" >= 0 AND "unknown_seat_wins" <= "unknown_seat_matches"),
				CONSTRAINT "pk_stats_deck_detail_matchups" 
					PRIMARY KEY ("format_id", "window_start", "deck_type_code", "opp_deck_type_code"),
				CONSTRAINT "fk_stats_deck_detail_matchups_run"
					FOREIGN KEY ("format_id", "window_start")
					REFERENCES "usage_stat_runs" ("format_id", "window_start")
					ON DELETE CASCADE,
				CONSTRAINT "ck_stats_deck_detail_matchups_matches_sum"
					CHECK ("matches" = "first_matches" + "second_matches" + "unknown_seat_matches"),
				CONSTRAINT "ck_stats_deck_detail_matchups_wins_sum"
					CHECK ("match_wins" = "first_wins" + "second_wins" + "unknown_seat_wins")
			)
		`);

		await queryRunner.query(`
			CREATE TABLE "stats_deck_top_players" (
				"format_id" varchar(16) NOT NULL CHECK ("format_id" = '1109'),
				"window_start" date NOT NULL,
				"deck_type_code" varchar(64) NOT NULL,
				"rank" smallint NOT NULL CHECK ("rank" BETWEEN 1 AND 10),
				"user_id" varchar(64) NOT NULL,
				"username" varchar(64) NOT NULL,
				"matches" integer NOT NULL CHECK ("matches" >= 25),
				"wins" integer NOT NULL CHECK ("wins" >= 0 AND "wins" <= "matches"),
				"losses" integer NOT NULL CHECK ("losses" >= 0 AND "losses" <= "matches"),
				"win_rate" double precision NOT NULL CHECK ("win_rate" >= 0.0 AND "win_rate" <= 1.0),
				CONSTRAINT "pk_stats_deck_top_players"
					PRIMARY KEY ("format_id", "window_start", "deck_type_code", "rank"),
				CONSTRAINT "fk_stats_deck_top_players_run"
					FOREIGN KEY ("format_id", "window_start")
					REFERENCES "usage_stat_runs" ("format_id", "window_start")
					ON DELETE CASCADE,
				CONSTRAINT "ck_stats_deck_top_players_record_sum"
					CHECK ("matches" = "wins" + "losses")
			)
		`);

		await queryRunner.query(`
			COMMENT ON TABLE "stats_deck_detail_matchups" IS '按赛制和自然半年保存各具名卡组对阵全对手的 8 项严格守恒计数';
			COMMENT ON COLUMN "stats_deck_detail_matchups"."format_id" IS '赛制编号（仅 1109）';
			COMMENT ON COLUMN "stats_deck_detail_matchups"."window_start" IS '自然半年北京时间起始日期（1月1日或7月1日）';
			COMMENT ON COLUMN "stats_deck_detail_matchups"."deck_type_code" IS '本方具名卡组代码（D01~D30）';
			COMMENT ON COLUMN "stats_deck_detail_matchups"."opp_deck_type_code" IS '对手卡组代码（D01~D30 或 unknown）';
			COMMENT ON COLUMN "stats_deck_detail_matchups"."matches" IS 'Match 对阵总场数';
			COMMENT ON COLUMN "stats_deck_detail_matchups"."match_wins" IS 'Match 胜场数';
			COMMENT ON COLUMN "stats_deck_detail_matchups"."first_matches" IS 'G1 先手总场数';
			COMMENT ON COLUMN "stats_deck_detail_matchups"."first_wins" IS 'G1 先手胜场数';
			COMMENT ON COLUMN "stats_deck_detail_matchups"."second_matches" IS 'G1 后手总场数';
			COMMENT ON COLUMN "stats_deck_detail_matchups"."second_wins" IS 'G1 后手胜场数';
			COMMENT ON COLUMN "stats_deck_detail_matchups"."unknown_seat_matches" IS 'G1 座次未知场数';
			COMMENT ON COLUMN "stats_deck_detail_matchups"."unknown_seat_wins" IS 'G1 座次未知胜场数';

			COMMENT ON TABLE "stats_deck_top_players" IS '按赛制和自然半年保存各具名卡组专精玩家胜率 Top10';
			COMMENT ON COLUMN "stats_deck_top_players"."format_id" IS '赛制编号（仅 1109）';
			COMMENT ON COLUMN "stats_deck_top_players"."window_start" IS '自然半年北京时间起始日期';
			COMMENT ON COLUMN "stats_deck_top_players"."deck_type_code" IS '本方具名卡组代码';
			COMMENT ON COLUMN "stats_deck_top_players"."rank" IS '玩家在当前卡组中的名次（1~10）';
			COMMENT ON COLUMN "stats_deck_top_players"."user_id" IS '用户系统内部唯一标识';
			COMMENT ON COLUMN "stats_deck_top_players"."username" IS '用户公开昵称';
			COMMENT ON COLUMN "stats_deck_top_players"."matches" IS '该卡组有效 Match 总场数（门槛 >= 25）';
			COMMENT ON COLUMN "stats_deck_top_players"."wins" IS '该卡组 Match 胜场数';
			COMMENT ON COLUMN "stats_deck_top_players"."losses" IS '该卡组 Match 负场数';
			COMMENT ON COLUMN "stats_deck_top_players"."win_rate" IS '完整精度胜率（wins / matches）';
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "stats_deck_top_players"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "stats_deck_detail_matchups"`);
	}
}
