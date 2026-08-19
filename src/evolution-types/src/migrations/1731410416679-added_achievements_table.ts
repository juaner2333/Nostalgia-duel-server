import { MigrationInterface, QueryRunner } from "typeorm";

export class AddedAchievementsTable1731410416679 implements MigrationInterface {
	name = "AddedAchievementsTable1731410416679";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TABLE "achievements" ("id" integer NOT NULL, "name" character varying NOT NULL, "description" character varying NOT NULL, "icon" character varying NOT NULL, "earned_points" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_1bc19c37c6249f70186f318d71d" PRIMARY KEY ("id"))`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "achievements"`);
	}
}
