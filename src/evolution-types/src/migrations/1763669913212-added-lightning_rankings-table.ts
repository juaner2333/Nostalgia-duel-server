import { MigrationInterface, QueryRunner } from "typeorm";

export class AddedLightningRankingsTable1763669913212 implements MigrationInterface {
	name = "AddedLightningRankingsTable1763669913212";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TABLE "lightning_rankings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" character varying NOT NULL, "points" integer NOT NULL DEFAULT '0', "tournaments_won" integer NOT NULL DEFAULT '0', "tournaments_played" integer NOT NULL DEFAULT '0', "season" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c371455f9bade2aed0eb6abb1f7" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_25604dc13cf832ce5cfb93fdcc" ON "lightning_rankings" ("user_id", "season") `
		);
		await queryRunner.query(
			`ALTER TABLE "lightning_rankings" ADD CONSTRAINT "FK_83c9583ae8ff9e32fdc3dbe8241" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "lightning_rankings" DROP CONSTRAINT "FK_83c9583ae8ff9e32fdc3dbe8241"`
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_25604dc13cf832ce5cfb93fdcc"`);
		await queryRunner.query(`DROP TABLE "lightning_rankings"`);
	}
}
