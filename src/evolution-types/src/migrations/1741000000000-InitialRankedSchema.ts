import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialRankedSchema1741000000000 implements MigrationInterface {
	name = "InitialRankedSchema1741000000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`CREATE TYPE "users_role_enum" AS ENUM ('admin', 'user')`);

		await queryRunner.query(`
			CREATE TABLE "users" (
				"id" character varying NOT NULL,
				"username" character varying NOT NULL,
				"password" character varying NOT NULL,
				"secure_password" character varying,
				"email" character varying,
				"avatar" text,
				"role" "users_role_enum" NOT NULL DEFAULT 'user',
				"discord_id" character varying,
				"participant_id" character varying,
				"created_at" TIMESTAMP NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP NOT NULL DEFAULT now(),
				"deleted_at" TIMESTAMP,
				CONSTRAINT "PK_users" PRIMARY KEY ("id"),
				CONSTRAINT "UQ_users_username" UNIQUE ("username"),
				CONSTRAINT "UQ_users_email" UNIQUE ("email")
			)
		`);

		await queryRunner.query(`
			CREATE TABLE "user_bans" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"reason" text NOT NULL,
				"banned_at" TIMESTAMP WITH TIME ZONE NOT NULL,
				"expires_at" TIMESTAMP WITH TIME ZONE,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"user_id" character varying,
				"banned_by" character varying,
				CONSTRAINT "PK_user_bans" PRIMARY KEY ("id"),
				CONSTRAINT "FK_user_bans_user" FOREIGN KEY ("user_id")
					REFERENCES "users"("id") ON DELETE CASCADE,
				CONSTRAINT "FK_user_bans_banned_by" FOREIGN KEY ("banned_by")
					REFERENCES "users"("id") ON DELETE SET NULL
			)
		`);

		await queryRunner.query(`
			CREATE TABLE "matches" (
				"id" character varying NOT NULL,
				"user_id" character varying NOT NULL,
				"game_id" uuid NOT NULL,
				"format_id" character varying NOT NULL,
				"best_of" integer NOT NULL,
				"player_names" text NOT NULL,
				"opponent_names" text NOT NULL,
				"date" TIMESTAMP NOT NULL,
				"ban_list_name" character varying NOT NULL,
				"ban_list_hash" character varying NOT NULL,
				"player_score" integer NOT NULL,
				"opponent_score" integer NOT NULL,
				"winner" boolean NOT NULL,
				"season" integer NOT NULL,
				"points" integer NOT NULL,
				"player_ids" text,
				"opponent_ids" text,
				"anulled" boolean NOT NULL DEFAULT false,
				"anulled_user_id" character varying,
				"anulled_reason" character varying,
				"anulled_by" character varying,
				"created_at" TIMESTAMP NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP NOT NULL DEFAULT now(),
				"deleted_at" TIMESTAMP,
				CONSTRAINT "PK_matches" PRIMARY KEY ("id"),
				CONSTRAINT "UQ_matches_game_user" UNIQUE ("game_id", "user_id"),
				CONSTRAINT "FK_matches_anulled_user" FOREIGN KEY ("anulled_user_id")
					REFERENCES "users"("id"),
				CONSTRAINT "FK_matches_anulled_by" FOREIGN KEY ("anulled_by")
					REFERENCES "users"("id")
			)
		`);

		await queryRunner.query(`
			CREATE INDEX "IDX_matches_format_season_user"
				ON "matches" ("format_id", "season", "user_id")
		`);

		await queryRunner.query(`
			CREATE TABLE "duel_replays" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"game_id" uuid NOT NULL,
				"duel_index" smallint NOT NULL,
				"format_id" character varying NOT NULL,
				"ban_list_name" character varying NOT NULL,
				"ban_list_hash" character varying NOT NULL,
				"replay_data" bytea NOT NULL,
				"started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
				"ended_at" TIMESTAMP WITH TIME ZONE NOT NULL,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_duel_replays" PRIMARY KEY ("id"),
				CONSTRAINT "UQ_duel_replays_game_duel" UNIQUE ("game_id", "duel_index"),
				CONSTRAINT "CK_duel_replays_duel_index" CHECK ("duel_index" > 0),
				CONSTRAINT "CK_duel_replays_time" CHECK ("ended_at" >= "started_at"),
				CONSTRAINT "CK_duel_replays_data" CHECK (octet_length("replay_data") > 0)
			)
		`);

		await queryRunner.query(`
			CREATE INDEX "IDX_duel_replays_format_ended"
				ON "duel_replays" ("format_id", "ended_at" DESC)
		`);

		await queryRunner.query(`
			CREATE TABLE "duels" (
				"id" character varying NOT NULL,
				"user_id" character varying NOT NULL,
				"game_id" uuid NOT NULL,
				"replay_id" uuid NOT NULL,
				"player_names" text NOT NULL,
				"opponent_names" text NOT NULL,
				"date" TIMESTAMP NOT NULL,
				"ban_list_name" character varying NOT NULL,
				"ban_list_hash" character varying NOT NULL,
				"result" character varying NOT NULL,
				"turns" integer NOT NULL,
				"match_id" character varying NOT NULL,
				"season" integer NOT NULL,
				"ip_address" character varying,
				"created_at" TIMESTAMP NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP NOT NULL DEFAULT now(),
				"deleted_at" TIMESTAMP,
				CONSTRAINT "PK_duels" PRIMARY KEY ("id"),
				CONSTRAINT "UQ_duels_user_replay" UNIQUE ("user_id", "replay_id")
			)
		`);

		await queryRunner.query(`
			CREATE INDEX "IDX_duels_replay" ON "duels" ("replay_id")
		`);

		await queryRunner.query(`
			CREATE TABLE "player_stats" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"ban_list_name" character varying NOT NULL,
				"format_id" character varying NOT NULL,
				"wins" integer NOT NULL,
				"losses" integer NOT NULL,
				"points" integer NOT NULL,
				"user_id" character varying NOT NULL,
				"season" integer NOT NULL,
				CONSTRAINT "PK_player_stats" PRIMARY KEY ("id"),
				CONSTRAINT "UQ_player_stats_user_format_season"
					UNIQUE ("user_id", "format_id", "season")
			)
		`);

		await queryRunner.query(`
			CREATE INDEX "IDX_player_stats_month"
				ON "player_stats" ("format_id", "season", "points" DESC, "wins" DESC)
		`);

		await queryRunner.query(`
			CREATE INDEX "IDX_player_stats_overall"
				ON "player_stats" ("format_id", "user_id")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "player_stats"`);
		await queryRunner.query(`DROP TABLE "duels"`);
		await queryRunner.query(`DROP TABLE "duel_replays"`);
		await queryRunner.query(`DROP TABLE "matches"`);
		await queryRunner.query(`DROP TABLE "user_bans"`);
		await queryRunner.query(`DROP TABLE "users"`);
		await queryRunner.query(`DROP TYPE "users_role_enum"`);
	}
}
