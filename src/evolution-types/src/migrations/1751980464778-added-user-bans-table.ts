import { MigrationInterface, QueryRunner } from "typeorm";

export class AddedUserBansTable1751980464778 implements MigrationInterface {
	name = "AddedUserBansTable1751980464778";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TABLE "user_bans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reason" text NOT NULL, "banned_at" TIMESTAMP WITH TIME ZONE NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" character varying, "banned_by" character varying, CONSTRAINT "PK_299b3ce7e72a9ac9aec5edeaf81" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(
			`ALTER TABLE "user_bans" ADD CONSTRAINT "FK_a142c9954b2fd911b3e7ea8c307" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
		);
		await queryRunner.query(
			`ALTER TABLE "user_bans" ADD CONSTRAINT "FK_3e0cbb4d7ad51d6e2e11633aa1a" FOREIGN KEY ("banned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "user_bans" DROP CONSTRAINT "FK_3e0cbb4d7ad51d6e2e11633aa1a"`
		);
		await queryRunner.query(
			`ALTER TABLE "user_bans" DROP CONSTRAINT "FK_a142c9954b2fd911b3e7ea8c307"`
		);
		await queryRunner.query(`DROP TABLE "user_bans"`);
	}
}
