import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReplayDeckAccess1741000001000 implements MigrationInterface {
	name = "AddReplayDeckAccess1741000001000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "deck_types" (
				"format_id" character varying(16) NOT NULL,
				"code" character varying(64) NOT NULL,
				"name_zh" character varying(64) NOT NULL,
				"sort_order" integer NOT NULL,
				CONSTRAINT "pk_deck_types" PRIMARY KEY ("format_id", "code"),
				CONSTRAINT "uq_deck_types_format_sort" UNIQUE ("format_id", "sort_order"),
				CONSTRAINT "ck_deck_types_sort_order" CHECK ("sort_order" >= 0)
			)
		`);

		await queryRunner.query(`
			ALTER TABLE "matches" ADD CONSTRAINT "uq_matches_id_format" UNIQUE ("id", "format_id")
		`);

		await queryRunner.query(`
			CREATE TABLE "match_decks" (
				"match_id" character varying NOT NULL,
				"format_id" character varying(16) NOT NULL,
				"deck_type_code" character varying(64) NOT NULL,
				"classifier_version" character varying(64) NOT NULL,
				"snapshot_source" character varying(16) NOT NULL,
				"main_cards" integer[] NOT NULL,
				"extra_cards" integer[] NOT NULL,
				"side_cards" integer[],
				CONSTRAINT "PK_match_decks" PRIMARY KEY ("match_id"),
				CONSTRAINT "fk_match_decks_match" FOREIGN KEY ("match_id", "format_id")
					REFERENCES "matches"("id", "format_id"),
				CONSTRAINT "fk_match_decks_type" FOREIGN KEY ("format_id", "deck_type_code")
					REFERENCES "deck_types"("format_id", "code"),
				CONSTRAINT "ck_match_decks_source"
					CHECK ("snapshot_source" IN ('online', 'replay_backfill')),
				CONSTRAINT "ck_match_decks_main_count"
					CHECK (cardinality("main_cards") BETWEEN 40 AND 60),
				CONSTRAINT "ck_match_decks_extra_count"
					CHECK (cardinality("extra_cards") BETWEEN 0 AND 15),
				CONSTRAINT "ck_match_decks_side_count"
					CHECK ("side_cards" IS NULL OR cardinality("side_cards") BETWEEN 0 AND 15)
			)
		`);

		await queryRunner.query(`
			CREATE INDEX "idx_match_decks_type_match"
				ON "match_decks" ("format_id", "deck_type_code", "match_id")
		`);

		await queryRunner.query(`
			INSERT INTO "deck_types" ("format_id", "code", "name_zh", "sort_order") VALUES
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
				('1109', 'D26', '神风鹰身', 25),
				('1109', 'D27', '念动力', 26),
				('1109', 'D28', '纯电子龙', 27),
				('1109', 'D29', '宝石骑士', 28),
				('1109', 'D30', '不死均', 29),
				('1109', 'OTHERS', '其他', 30)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "idx_match_decks_type_match"`);
		await queryRunner.query(`DROP TABLE "match_decks"`);
		await queryRunner.query(
			`ALTER TABLE "matches" DROP CONSTRAINT "uq_matches_id_format"`,
		);
		await queryRunner.query(`DROP TABLE "deck_types"`);
	}
}
