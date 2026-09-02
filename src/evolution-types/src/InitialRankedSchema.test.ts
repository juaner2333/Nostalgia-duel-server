import { InitialRankedSchema1741000000000 } from "./migrations/1741000000000-InitialRankedSchema";
import { dataSource } from "./data-source";
import { UserProfileEntity } from "./entities/UserProfileEntity";
import { UserBanEntity } from "./entities/UserBanEntity";
import { MatchResumeEntity } from "./entities/MatchResumeEntity";
import { DuelReplayEntity } from "./entities/DuelReplayEntity";
import { DuelResumeEntity } from "./entities/DuelResumeEntity";
import { PlayerStatsEntity } from "./entities/PlayerStatsEntity";

describe("InitialRankedSchema and DataSource baseline", () => {
	it("registers exactly the six target ranked entities", () => {
		const entities = (dataSource.options.entities as Function[]).map((e) => e.name);
		expect(entities).toEqual([
			UserProfileEntity.name,
			UserBanEntity.name,
			MatchResumeEntity.name,
			DuelReplayEntity.name,
			DuelResumeEntity.name,
			PlayerStatsEntity.name,
		]);
		expect(entities).toHaveLength(6);
	});

	it("runs InitialRankedSchema up and down queries matching DDL specification", async () => {
		const migration = new InitialRankedSchema1741000000000();
		const queriesExecuted: string[] = [];
		const mockQueryRunner = {
			query: jest.fn().mockImplementation((q: string) => {
				queriesExecuted.push(q);
				return Promise.resolve();
			}),
		};

		await migration.up(mockQueryRunner as any);
		expect(mockQueryRunner.query).toHaveBeenCalled();

		// Check for all 6 tables and enum in up
		const upSql = queriesExecuted.join("\n");
		expect(upSql).toContain(`CREATE TYPE "users_role_enum"`);
		expect(upSql).toContain(`CREATE TABLE "users"`);
		expect(upSql).toContain(`CREATE TABLE "user_bans"`);
		expect(upSql).toContain(`CREATE TABLE "matches"`);
		expect(upSql).toContain(`CREATE TABLE "duel_replays"`);
		expect(upSql).toContain(`CREATE TABLE "duels"`);
		expect(upSql).toContain(`CREATE TABLE "player_stats"`);
		expect(upSql).toContain(`IDX_matches_format_season_user`);
		expect(upSql).toContain(`IDX_duel_replays_format_ended`);
		expect(upSql).toContain(`IDX_duels_replay`);
		expect(upSql).toContain(`IDX_player_stats_month`);
		expect(upSql).toContain(`IDX_player_stats_overall`);

		// No non-ranked tables
		expect(upSql).not.toContain("tournaments");
		expect(upSql).not.toContain("achievements");
		expect(upSql).not.toContain("unranked_matches");
		expect(upSql).not.toContain("lightning_tournaments");

		// Down drops all tables
		queriesExecuted.length = 0;
		await migration.down(mockQueryRunner as any);
		const downSql = queriesExecuted.join("\n");
		expect(downSql).toContain(`DROP TABLE "player_stats"`);
		expect(downSql).toContain(`DROP TABLE "duels"`);
		expect(downSql).toContain(`DROP TABLE "duel_replays"`);
		expect(downSql).toContain(`DROP TABLE "matches"`);
		expect(downSql).toContain(`DROP TABLE "user_bans"`);
		expect(downSql).toContain(`DROP TABLE "users"`);
		expect(downSql).toContain(`DROP TYPE "users_role_enum"`);
	});
});
