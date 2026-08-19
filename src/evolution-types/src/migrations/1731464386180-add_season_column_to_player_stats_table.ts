import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSeasonColumnToPlayerStatsTable1731464386180 implements MigrationInterface {
	name = "AddSeasonColumnToPlayerStatsTable1731464386180";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "player_stats" ADD "season" integer`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "player_stats" DROP COLUMN "season"`);
	}
}
