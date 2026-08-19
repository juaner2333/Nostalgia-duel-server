import { MigrationInterface, QueryRunner } from "typeorm";

export class AddedIpAddressToDuels1750794478681 implements MigrationInterface {
	name = "AddedIpAddressToDuels1750794478681";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "duels" ADD "ip_address" character varying`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "duels" DROP COLUMN "ip_address"`);
	}
}
