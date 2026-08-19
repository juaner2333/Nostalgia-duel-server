import { MigrationInterface, QueryRunner } from "typeorm";

export class AlterLabelsColumnInUserAchievements1731461358622 implements MigrationInterface {
	name = "AlterLabelsColumnInUserAchievements1731461358622";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "user_achievements" DROP COLUMN "labels"`);
		await queryRunner.query(`ALTER TABLE "user_achievements" ADD "labels" json NOT NULL`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "user_achievements" DROP COLUMN "labels"`);
		await queryRunner.query(`ALTER TABLE "user_achievements" ADD "labels" text NOT NULL`);
	}
}
