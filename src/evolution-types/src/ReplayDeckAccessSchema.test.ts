import { dataSource } from "./data-source";
import { DeckTypeEntity } from "./entities/DeckTypeEntity";
import { MatchDeckEntity } from "./entities/MatchDeckEntity";
import { MatchResumeEntity } from "./entities/MatchResumeEntity";
import { getMetadataArgsStorage } from "typeorm";

describe("ReplayDeckAccess Schema Entities", () => {
	it("registers DeckTypeEntity and MatchDeckEntity in dataSource", () => {
		const entities = (dataSource.options.entities as Function[]).map((e) => e.name);
		expect(entities).toContain(DeckTypeEntity.name);
		expect(entities).toContain(MatchDeckEntity.name);
		expect(entities.length).toBeGreaterThanOrEqual(8);
	});

	it("configures MatchResumeEntity with uq_matches_id_format unique constraint", () => {
		const uniques = getMetadataArgsStorage().uniques.filter(
			(u) => u.target === MatchResumeEntity,
		);
		const matchIdFormatUnique = uniques.find((u) => u.name === "uq_matches_id_format");
		expect(matchIdFormatUnique).toBeDefined();
		expect(matchIdFormatUnique?.columns).toEqual(["id", "formatId"]);
	});

	it("configures DeckTypeEntity with primary key, unique, and check constraints", () => {
		const tables = getMetadataArgsStorage().tables.filter((t) => t.target === DeckTypeEntity);
		expect(tables[0]?.name).toBe("deck_types");

		const columns = getMetadataArgsStorage().columns.filter(
			(c) => c.target === DeckTypeEntity,
		);
		const colNames = columns.map((c) => c.options.name || c.propertyName);
		expect(colNames).toContain("format_id");
		expect(colNames).toContain("code");
		expect(colNames).toContain("name_zh");
		expect(colNames).toContain("sort_order");

		const uniques = getMetadataArgsStorage().uniques.filter(
			(u) => u.target === DeckTypeEntity,
		);
		const formatSortUnique = uniques.find((u) => u.name === "uq_deck_types_format_sort");
		expect(formatSortUnique).toBeDefined();
		expect(formatSortUnique?.columns).toEqual(["formatId", "sortOrder"]);

		const checks = getMetadataArgsStorage().checks.filter(
			(c) => c.target === DeckTypeEntity,
		);
		const sortCheck = checks.find((c) => c.name === "ck_deck_types_sort_order");
		expect(sortCheck).toBeDefined();
		expect(sortCheck?.expression).toBe("sort_order >= 0");
	});

	it("configures MatchDeckEntity with columns, checks, index, and relations", () => {
		const tables = getMetadataArgsStorage().tables.filter((t) => t.target === MatchDeckEntity);
		expect(tables[0]?.name).toBe("match_decks");

		const columns = getMetadataArgsStorage().columns.filter(
			(c) => c.target === MatchDeckEntity,
		);
		const colNames = columns.map((c) => c.options.name || c.propertyName);
		expect(colNames).toContain("match_id");
		expect(colNames).toContain("format_id");
		expect(colNames).toContain("deck_type_code");
		expect(colNames).toContain("classifier_version");
		expect(colNames).toContain("snapshot_source");
		expect(colNames).toContain("main_cards");
		expect(colNames).toContain("extra_cards");
		expect(colNames).toContain("side_cards");

		const checks = getMetadataArgsStorage().checks.filter(
			(c) => c.target === MatchDeckEntity,
		);
		expect(checks.find((c) => c.name === "ck_match_decks_source")?.expression).toBe(
			"snapshot_source IN ('online', 'replay_backfill')",
		);
		expect(checks.find((c) => c.name === "ck_match_decks_main_count")?.expression).toBe(
			"cardinality(main_cards) BETWEEN 40 AND 60",
		);
		expect(checks.find((c) => c.name === "ck_match_decks_extra_count")?.expression).toBe(
			"cardinality(extra_cards) BETWEEN 0 AND 15",
		);
		expect(checks.find((c) => c.name === "ck_match_decks_side_count")?.expression).toBe(
			"side_cards IS NULL OR cardinality(side_cards) BETWEEN 0 AND 15",
		);

		const indices = getMetadataArgsStorage().indices.filter(
			(i) => i.target === MatchDeckEntity,
		);
		const typeMatchIndex = indices.find((i) => i.name === "idx_match_decks_type_match");
		expect(typeMatchIndex).toBeDefined();
		expect(typeMatchIndex?.columns).toEqual(["formatId", "deckTypeCode", "matchId"]);
	});

	it("runs AddReplayDeckAccess migration up and down matching ddl.sql", async () => {
		const { AddReplayDeckAccess1741000001000 } = require("./migrations/1741000001000-AddReplayDeckAccess");
		const migration = new AddReplayDeckAccess1741000001000();
		const queriesExecuted: string[] = [];
		const mockQueryRunner = {
			query: jest.fn().mockImplementation((q: string) => {
				queriesExecuted.push(q);
				return Promise.resolve();
			}),
		};

		await migration.up(mockQueryRunner as any);
		expect(mockQueryRunner.query).toHaveBeenCalled();

		const upSql = queriesExecuted.join("\n");
		expect(upSql).toContain(`CREATE TABLE "deck_types"`);
		expect(upSql).toContain(`uq_deck_types_format_sort`);
		expect(upSql).toContain(`ck_deck_types_sort_order`);
		expect(upSql).toContain(`ALTER TABLE "matches" ADD CONSTRAINT "uq_matches_id_format" UNIQUE ("id", "format_id")`);
		expect(upSql).toContain(`CREATE TABLE "match_decks"`);
		expect(upSql).toContain(`fk_match_decks_match`);
		expect(upSql).toContain(`fk_match_decks_type`);
		expect(upSql).toContain(`ck_match_decks_source`);
		expect(upSql).toContain(`ck_match_decks_main_count`);
		expect(upSql).toContain(`ck_match_decks_extra_count`);
		expect(upSql).toContain(`ck_match_decks_side_count`);
		expect(upSql).toContain(`CREATE INDEX "idx_match_decks_type_match"`);
		expect(upSql).toContain(`INSERT INTO "deck_types"`);
		expect(upSql).toContain(`'1103', 'OTHERS', '其他', 0`);
		expect(upSql).toContain(`'1109', 'D01', '代行天使', 0`);
		expect(upSql).toContain(`'1109', 'D25', '水泡英雄', 24`);
		expect(upSql).toContain(`'1109', 'D30', '不死均', 29`);
		expect(upSql).toContain(`'1109', 'OTHERS', '其他', 30`);

		queriesExecuted.length = 0;
		await migration.down(mockQueryRunner as any);
		const downSql = queriesExecuted.join("\n");
		expect(downSql).toContain(`DROP TABLE "match_decks"`);
		expect(downSql).toContain(`ALTER TABLE "matches" DROP CONSTRAINT "uq_matches_id_format"`);
		expect(downSql).toContain(`DROP TABLE "deck_types"`);
	});
});

