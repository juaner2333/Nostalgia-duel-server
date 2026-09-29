import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMatchupsEvaluated1790619192715 implements MigrationInterface {
	name = "AddMatchupsEvaluated1790619192715";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "usage_stat_runs" ADD "matchups_evaluated" boolean NOT NULL DEFAULT false`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "usage_stat_runs"."matchups_evaluated" IS '1109 批次是否已按对阵矩阵逻辑完整评估；零对阵行但已评估的批次不再触发换期补建，1103 恒为 false'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "usage_stat_runs" DROP COLUMN "matchups_evaluated"`);
	}
}
