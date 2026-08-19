import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSecurePasswordToUsers1780621680559 implements MigrationInterface {
	name = "AddSecurePasswordToUsers1780621680559";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "users" ADD "secure_password" character varying`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "secure_password"`);
	}
}
