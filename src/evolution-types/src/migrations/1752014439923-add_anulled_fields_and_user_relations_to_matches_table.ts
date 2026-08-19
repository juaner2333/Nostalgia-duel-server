import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAnulledFieldsAndUserRelationsToMatchesTable1752014439923
	implements MigrationInterface
{
	name = "AddAnulledFieldsAndUserRelationsToMatchesTable1752014439923";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "matches" ADD "player_ids" text`);
		await queryRunner.query(`ALTER TABLE "matches" ADD "opponent_ids" text`);
		await queryRunner.query(`ALTER TABLE "matches" ADD "anulled" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "matches" ADD "anulled_user_id" character varying`);
		await queryRunner.query(`ALTER TABLE "matches" ADD "anulled_reason" character varying`);
		await queryRunner.query(`ALTER TABLE "matches" ADD "anulled_by" character varying`);
		await queryRunner.query(
			`ALTER TABLE "matches" ADD CONSTRAINT "FK_7783304b9cd35aed3c397fb2e85" FOREIGN KEY ("anulled_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
		);
		await queryRunner.query(
			`ALTER TABLE "matches" ADD CONSTRAINT "FK_1d66e3d79be82ad7b56f6187960" FOREIGN KEY ("anulled_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "matches" DROP CONSTRAINT "FK_1d66e3d79be82ad7b56f6187960"`
		);
		await queryRunner.query(
			`ALTER TABLE "matches" DROP CONSTRAINT "FK_7783304b9cd35aed3c397fb2e85"`
		);
		await queryRunner.query(`ALTER TABLE "matches" DROP COLUMN "anulled_by"`);
		await queryRunner.query(`ALTER TABLE "matches" DROP COLUMN "anulled_reason"`);
		await queryRunner.query(`ALTER TABLE "matches" DROP COLUMN "anulled_user_id"`);
		await queryRunner.query(`ALTER TABLE "matches" DROP COLUMN "anulled"`);
		await queryRunner.query(`ALTER TABLE "matches" DROP COLUMN "opponent_ids"`);
		await queryRunner.query(`ALTER TABLE "matches" DROP COLUMN "player_ids"`);
	}
}
