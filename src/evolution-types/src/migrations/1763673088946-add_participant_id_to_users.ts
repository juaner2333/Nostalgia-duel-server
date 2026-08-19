import { MigrationInterface, QueryRunner } from "typeorm";

export class AddParticipantIdToUsers1763673088946 implements MigrationInterface {
	name = "AddParticipantIdToUsers1763673088946";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "users" ADD "participant_id" character varying`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "participant_id"`);
	}
}
