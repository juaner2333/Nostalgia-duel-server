import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameUserIdToUserIdAtTournamentsTable1748981272072 implements MigrationInterface {
	name = "RenameUserIdToUserIdAtTournamentsTable1748981272072";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "tournaments" RENAME COLUMN "userId" TO "user_id"`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "tournaments" RENAME COLUMN "user_id" TO "userId"`);
	}
}
