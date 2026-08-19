import { MigrationInterface, QueryRunner } from "typeorm";

export class SeasonNotNullInPlayerStats1732784223632 implements MigrationInterface {
	name = "SeasonNotNullInPlayerStats1732784223632";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "player_stats" ALTER COLUMN "season" SET NOT NULL`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "player_stats" ALTER COLUMN "season" DROP NOT NULL`);
	}
}
