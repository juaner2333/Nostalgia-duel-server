import { getMetadataArgsStorage } from "typeorm";
import { dataSource } from "./data-source";
import { DuelResumeEntity } from "./entities/DuelResumeEntity";
import { MatchResumeEntity } from "./entities/MatchResumeEntity";
import { StatsDeckMatchupEntity } from "./entities/StatsDeckMatchupEntity";
import { AddHalfYearDeckMatchups1741000003000 } from "./migrations/1741000003000-AddHalfYearDeckMatchups";

describe("DeckMatchup Schema Entities and Migration", () => {
	it("registers StatsDeckMatchupEntity in dataSource", () => {
		const entities = (dataSource.options.entities as Function[]).map((e) => e.name);
		expect(entities).toContain(StatsDeckMatchupEntity.name);
	});

	it("configures StatsDeckMatchupEntity with composite primary key, checks, indices, and relations", () => {
		const tables = getMetadataArgsStorage().tables.filter(
			(t) => t.target === StatsDeckMatchupEntity,
		);
		expect(tables[0]?.name).toBe("stats_deck_matchups");

		const columns = getMetadataArgsStorage().columns.filter(
			(c) => c.target === StatsDeckMatchupEntity,
		);
		const colNames = columns.map((c) => c.options.name || c.propertyName);
		expect(colNames).toContain("format_id");
		expect(colNames).toContain("window_start");
		expect(colNames).toContain("first_deck_code");
		expect(colNames).toContain("second_deck_code");
		expect(colNames).toContain("match_count");
		expect(colNames).toContain("first_wins");

		const pks = columns.filter((c) => c.options.primary);
		const pkNames = pks.map((c) => c.options.name || c.propertyName);
		expect(pkNames).toEqual([
			"format_id",
			"window_start",
			"first_deck_code",
			"second_deck_code",
		]);

		const checks = getMetadataArgsStorage().checks.filter(
			(c) => c.target === StatsDeckMatchupEntity,
		);
		const checkExpressions = checks.map((c) => c.expression);
		expect(checkExpressions).toContain("format_id = '1109'");
		expect(checkExpressions).toContain(
			"first_deck_code <> 'OTHERS' AND second_deck_code <> 'OTHERS'",
		);
		expect(checkExpressions).toContain(
			"match_count > 0 AND first_wins BETWEEN 0 AND match_count",
		);

		const indices = getMetadataArgsStorage().indices.filter(
			(i) => i.target === StatsDeckMatchupEntity,
		);
		const indexNames = indices.map((i) => i.name);
		expect(indexNames).toContain("idx_stats_deck_matchups_second");

		const relations = getMetadataArgsStorage().relations.filter(
			(r) => r.target === StatsDeckMatchupEntity,
		);
		expect(relations).toHaveLength(3);
	});

	it("configures DuelResumeEntity with duelIndex, isFirst, checks, and partial unique index", () => {
		const columns = getMetadataArgsStorage().columns.filter(
			(c) => c.target === DuelResumeEntity,
		);
		const colNames = columns.map((c) => c.options.name || c.propertyName);
		expect(colNames).toContain("duel_index");
		expect(colNames).toContain("is_first");

		const checks = getMetadataArgsStorage().checks.filter(
			(c) => c.target === DuelResumeEntity,
		);
		const checkExpressions = checks.map((c) => c.expression);
		expect(checkExpressions).toContain("duel_index IS NULL OR duel_index BETWEEN 1 AND 3");
		expect(checkExpressions).toContain("is_first IS NULL OR duel_index IS NOT NULL");

		const indices = getMetadataArgsStorage().indices.filter(
			(i) => i.target === DuelResumeEntity,
		);
		const partialIndex = indices.find(
			(i) => i.name === "uq_duels_active_match_duel_index",
		);
		expect(partialIndex).toBeDefined();
		expect(partialIndex?.unique).toBe(true);
		expect(partialIndex?.where).toBe("duel_index IS NOT NULL AND deleted_at IS NULL");
	});

	it("configures MatchResumeEntity with idx_matches_matchup_active_game index", () => {
		const indices = getMetadataArgsStorage().indices.filter(
			(i) => i.target === MatchResumeEntity,
		);
		const activeGameIndex = indices.find(
			(i) => i.name === "idx_matches_matchup_active_game",
		);
		expect(activeGameIndex).toBeDefined();
		expect(activeGameIndex?.where).toBe("deleted_at IS NULL AND anulled = false");
	});

	it("executes AddHalfYearDeckMatchups migration up and down matching DDL", async () => {
		const migration = new AddHalfYearDeckMatchups1741000003000();
		const queriesUp: string[] = [];
		const queriesDown: string[] = [];

		const mockRunnerUp = {
			query: jest.fn().mockImplementation((q: string) => {
				queriesUp.push(q);
				return Promise.resolve();
			}),
		};

		await migration.up(mockRunnerUp as any);
		expect(mockRunnerUp.query).toHaveBeenCalled();
		const upSql = queriesUp.join("\n");
		expect(upSql).toContain(`ALTER TABLE "duels"`);
		expect(upSql).toContain(`"duel_index" smallint NULL`);
		expect(upSql).toContain(`"is_first" boolean NULL`);
		expect(upSql).toContain(`ck_duels_matchup_duel_index`);
		expect(upSql).toContain(`ck_duels_matchup_first_requires_index`);
		expect(upSql).toContain(`uq_duels_active_match_duel_index`);
		expect(upSql).toContain(`idx_matches_matchup_active_game`);
		expect(upSql).toContain(`CREATE TABLE "stats_deck_matchups"`);
		expect(upSql).toContain(`ck_stats_deck_matchups_format`);
		expect(upSql).toContain(`ck_stats_deck_matchups_named_only`);
		expect(upSql).toContain(`ck_stats_deck_matchups_counts`);
		expect(upSql).toContain(`idx_stats_deck_matchups_second`);

		const mockRunnerDown = {
			query: jest.fn().mockImplementation((q: string) => {
				queriesDown.push(q);
				return Promise.resolve();
			}),
		};

		await migration.down(mockRunnerDown as any);
		expect(mockRunnerDown.query).toHaveBeenCalled();
		const downSql = queriesDown.join("\n");
		expect(downSql).toContain(`DROP TABLE IF EXISTS "stats_deck_matchups"`);
		expect(downSql).toContain(`DROP INDEX IF EXISTS "idx_matches_matchup_active_game"`);
		expect(downSql).toContain(`DROP INDEX IF EXISTS "uq_duels_active_match_duel_index"`);
		expect(downSql).toContain(`DROP COLUMN IF EXISTS "duel_index"`);
	});
});
