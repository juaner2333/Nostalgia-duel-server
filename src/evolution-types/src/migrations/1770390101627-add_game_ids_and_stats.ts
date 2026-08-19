import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGameIdsAndStats1770390101627 implements MigrationInterface {
    name = "AddGameIdsAndStats1770390101627";

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Step 1: Add game_id column to matches and duels
        await queryRunner.query(`ALTER TABLE "matches" ADD "game_id" uuid`);
        await queryRunner.query(`ALTER TABLE "duels" ADD "game_id" uuid`);

        // Step 2: Backfill matches.game_id
        // Group by date to identify unique games and assign a unique UUID to each group
        await queryRunner.query(`
            UPDATE matches m 
            SET game_id = sub.gid 
            FROM (
                SELECT date, gen_random_uuid() as gid 
                FROM matches 
                GROUP BY date
            ) sub 
            WHERE m.date = sub.date
        `);

        // Step 3: Backfill duels.game_id using the match relation
        await queryRunner.query(`
            UPDATE duels d
            SET game_id = m.game_id
            FROM matches m
            WHERE d.match_id = m.id
        `);

        // Step 4: Add index for performance
        await queryRunner.query(`CREATE INDEX "IDX_matches_game_id" ON "matches" ("game_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_duels_game_id" ON "duels" ("game_id")`);

        // Step 5: Create stats_daily_summary table
        await queryRunner.query(`
            CREATE TABLE "stats_daily_summary" (
                "date" date NOT NULL,
                "ban_list_name" character varying NOT NULL,
                "season" integer NOT NULL,
                "total_duels" integer NOT NULL DEFAULT 0,
                CONSTRAINT "PK_stats_daily_summary" PRIMARY KEY ("date", "ban_list_name", "season")
            )
        `);

        // Step 6: Backfill stats_daily_summary from existing data
        await queryRunner.query(`
            INSERT INTO "stats_daily_summary" ("date", "ban_list_name", "season", "total_duels")
            SELECT 
                date_trunc('day', date)::date as day_date,
                ban_list_name,
                season,
                COUNT(DISTINCT game_id) as total_duels
            FROM matches
            GROUP BY day_date, ban_list_name, season
            ON CONFLICT DO NOTHING
        `);

        // Step 7: Create Trigger Function
        await queryRunner.query(`
            CREATE OR REPLACE FUNCTION update_daily_stats()
            RETURNS TRIGGER AS $$
            BEGIN
                -- Check if this is the first record for this game_id to avoid double counting
                -- We count visible rows for this game_id including the one just inserted
                IF (SELECT COUNT(*) FROM matches WHERE game_id = NEW.game_id) = 1 THEN
                    INSERT INTO stats_daily_summary (date, ban_list_name, season, total_duels)
                    VALUES (
                        date_trunc('day', NEW.date)::date,
                        NEW.ban_list_name,
                        NEW.season,
                        1
                    )
                    ON CONFLICT (date, ban_list_name, season)
                    DO UPDATE SET total_duels = stats_daily_summary.total_duels + 1;
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);

        // Step 8: Create Trigger
        await queryRunner.query(`
            CREATE TRIGGER trg_update_daily_stats
            AFTER INSERT ON matches
            FOR EACH ROW
            EXECUTE FUNCTION update_daily_stats();
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TRIGGER IF EXISTS trg_update_daily_stats ON "matches"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS update_daily_stats`);
        await queryRunner.query(`DROP TABLE "stats_daily_summary"`);
        await queryRunner.query(`DROP INDEX "IDX_duels_game_id"`);
        await queryRunner.query(`DROP INDEX "IDX_matches_game_id"`);
        await queryRunner.query(`ALTER TABLE "duels" DROP COLUMN "game_id"`);
        await queryRunner.query(`ALTER TABLE "matches" DROP COLUMN "game_id"`);
    }
}
