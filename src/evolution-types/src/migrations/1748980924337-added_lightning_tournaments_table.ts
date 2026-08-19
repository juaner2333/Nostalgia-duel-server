import { MigrationInterface, QueryRunner } from "typeorm";

export class AddedLightningTournamentsTable1748980924337 implements MigrationInterface {
	name = "AddedLightningTournamentsTable1748980924337";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TABLE "lightning_tournaments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tournament_id" character varying NOT NULL, "season" character varying NOT NULL, "completed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_df405d467433a9710deedfe0ecc" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(
			`ALTER TABLE "lightning_tournaments" ADD CONSTRAINT "FK_a0d63d6dbf1fa694d588e92cba1" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "lightning_tournaments" DROP CONSTRAINT "FK_a0d63d6dbf1fa694d588e92cba1"`
		);
		await queryRunner.query(`DROP TABLE "lightning_tournaments"`);
	}
}
