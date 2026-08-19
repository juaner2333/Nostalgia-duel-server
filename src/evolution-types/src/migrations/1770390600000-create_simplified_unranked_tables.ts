import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSimplifiedUnrankedTables1770390600000 implements MigrationInterface {
    name = "CreateSimplifiedUnrankedTables1770390600000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create unranked_matches table
        await queryRunner.query(`
            CREATE TABLE "unranked_matches" (
                "id" character varying NOT NULL,
                "game_id" uuid NOT NULL,
                "best_of" integer NOT NULL,
                "player_names" text NOT NULL,
                "opponent_names" text NOT NULL,
                "date" timestamp without time zone NOT NULL,
                "ban_list_name" character varying NOT NULL,
                "ban_list_hash" character varying NOT NULL,
                "team_0_score" integer NOT NULL,
                "team_1_score" integer NOT NULL,
                "winner_team" integer NOT NULL,
                "season" integer NOT NULL,
                "created_at" timestamp without time zone NOT NULL DEFAULT now(),
                "updated_at" timestamp without time zone NOT NULL DEFAULT now(),
                CONSTRAINT "PK_unranked_matches" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_unranked_matches_game_id" ON "unranked_matches" ("game_id")`);

        // Create unranked_duels table
        await queryRunner.query(`
            CREATE TABLE "unranked_duels" (
                "id" character varying NOT NULL,
                "game_id" uuid NOT NULL,
                "date" timestamp without time zone NOT NULL,
                "ban_list_name" character varying NOT NULL,
                "ban_list_hash" character varying NOT NULL,
                "team_0_score" integer NOT NULL,
                "team_1_score" integer NOT NULL,
                "winner_team" integer NOT NULL,
                "turns" integer NOT NULL,
                "match_id" character varying NOT NULL,
                "season" integer NOT NULL,
                "ip_address" character varying,
                "created_at" timestamp without time zone NOT NULL DEFAULT now(),
                "updated_at" timestamp without time zone NOT NULL DEFAULT now(),
                CONSTRAINT "PK_unranked_duels" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_unranked_duels_game_id" ON "unranked_duels" ("game_id")`);

        // Create Trigger Function for Unranked Matches
        await queryRunner.query(`
            CREATE OR REPLACE FUNCTION update_daily_stats_unranked()
            RETURNS TRIGGER AS $$
            BEGIN
                -- Every insert in unranked_matches is a new match (since we only save one per match)
                INSERT INTO stats_daily_summary (date, ban_list_name, season, total_duels)
                VALUES (
                    date_trunc('day', NEW.date)::date,
                    NEW.ban_list_name,
                    NEW.season,
                    1
                )
                ON CONFLICT (date, ban_list_name, season)
                DO UPDATE SET total_duels = stats_daily_summary.total_duels + 1;
                
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);

        // Create Trigger
        await queryRunner.query(`
            CREATE TRIGGER trg_update_daily_stats_unranked
            AFTER INSERT ON unranked_matches
            FOR EACH ROW
            EXECUTE FUNCTION update_daily_stats_unranked();
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TRIGGER IF EXISTS trg_update_daily_stats_unranked ON "unranked_matches"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS update_daily_stats_unranked`);
        await queryRunner.query(`DROP TABLE "unranked_duels"`);
        await queryRunner.query(`DROP TABLE "unranked_matches"`);
    }
}
