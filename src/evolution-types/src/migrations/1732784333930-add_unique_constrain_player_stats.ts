import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUniqueConstrainPlayerStats1732784333930 implements MigrationInterface {
	name = "AddUniqueConstrainPlayerStats1732784333930";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "public"."IDX_3fef284ca080f86ca80a050260"`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_23e2bf8c6fb0b1ed0462bec18d" ON "player_stats" ("user_id", "ban_list_name", "season") `
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "public"."IDX_23e2bf8c6fb0b1ed0462bec18d"`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_3fef284ca080f86ca80a050260" ON "player_stats" ("ban_list_name", "user_id") `
		);
	}
}
