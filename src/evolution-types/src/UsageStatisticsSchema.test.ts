import { getMetadataArgsStorage } from "typeorm";
import { dataSource } from "./data-source";
import { UsageStatRunEntity } from "./entities/UsageStatRunEntity";
import { UsageDeckRowEntity } from "./entities/UsageDeckRowEntity";
import { UsageCardRowEntity } from "./entities/UsageCardRowEntity";

describe("UsageStatistics Schema Entities", () => {
	it("registers UsageStatRunEntity, UsageDeckRowEntity, and UsageCardRowEntity in dataSource", () => {
		const entities = (dataSource.options.entities as Function[]).map((e) => e.name);
		expect(entities).toContain(UsageStatRunEntity.name);
		expect(entities).toContain(UsageDeckRowEntity.name);
		expect(entities).toContain(UsageCardRowEntity.name);
	});

	it("configures UsageStatRunEntity with composite primary key, checks, and no foreign keys", () => {
		const tables = getMetadataArgsStorage().tables.filter((t) => t.target === UsageStatRunEntity);
		expect(tables[0]?.name).toBe("usage_stat_runs");

		const columns = getMetadataArgsStorage().columns.filter(
			(c) => c.target === UsageStatRunEntity,
		);
		const colNames = columns.map((c) => c.options.name || c.propertyName);
		expect(colNames).toContain("format_id");
		expect(colNames).toContain("window_start");
		expect(colNames).toContain("window_end_exclusive");
		expect(colNames).toContain("data_end_exclusive");
		expect(colNames).toContain("published_at");
		expect(colNames).toContain("total_decks");
		expect(colNames).toContain("side_known_decks");

		// Primary keys: formatId and windowStart
		const pks = columns.filter((c) => c.options.primary);
		const pkNames = pks.map((c) => c.options.name || c.propertyName);
		expect(pkNames).toEqual(expect.arrayContaining(["format_id", "window_start"]));
		expect(pkNames).toHaveLength(2);

		const checks = getMetadataArgsStorage().checks.filter(
			(c) => c.target === UsageStatRunEntity,
		);
		const checkExpressions = checks.map((c) => c.expression);
		expect(checkExpressions).toContain("format_id IN ('1103', '1109')");
		expect(checkExpressions).toContain("total_decks >= 0");
		expect(checkExpressions).toContain(
			"side_known_decks >= 0 AND side_known_decks <= total_decks",
		);
		expect(checkExpressions).toContain(
			"EXTRACT(DAY FROM window_start) = 1 AND EXTRACT(MONTH FROM window_start) IN (1, 7)",
		);
		expect(checkExpressions).toContain(
			"window_end_exclusive = (window_start + INTERVAL '6 months')::date",
		);
		expect(checkExpressions).toContain(
			"data_end_exclusive BETWEEN window_start AND window_end_exclusive",
		);

		// No foreign keys / relations
		const relations = getMetadataArgsStorage().relations.filter(
			(r) => r.target === UsageStatRunEntity,
		);
		expect(relations).toHaveLength(0);
	});

	it("configures UsageDeckRowEntity with composite primary key, rank index, checks, and no foreign keys", () => {
		const tables = getMetadataArgsStorage().tables.filter((t) => t.target === UsageDeckRowEntity);
		expect(tables[0]?.name).toBe("usage_deck_rows");

		const columns = getMetadataArgsStorage().columns.filter(
			(c) => c.target === UsageDeckRowEntity,
		);
		const colNames = columns.map((c) => c.options.name || c.propertyName);
		expect(colNames).toContain("format_id");
		expect(colNames).toContain("window_start");
		expect(colNames).toContain("deck_type_code");
		expect(colNames).toContain("deck_count");

		const pks = columns.filter((c) => c.options.primary);
		const pkNames = pks.map((c) => c.options.name || c.propertyName);
		expect(pkNames).toEqual(
			expect.arrayContaining(["format_id", "window_start", "deck_type_code"]),
		);
		expect(pkNames).toHaveLength(3);

		const checks = getMetadataArgsStorage().checks.filter(
			(c) => c.target === UsageDeckRowEntity,
		);
		const checkExpressions = checks.map((c) => c.expression);
		expect(checkExpressions).toContain("format_id IN ('1103', '1109')");
		expect(checkExpressions).toContain("deck_count > 0");
		expect(checkExpressions).toContain(
			"EXTRACT(DAY FROM window_start) = 1 AND EXTRACT(MONTH FROM window_start) IN (1, 7)",
		);

		const indices = getMetadataArgsStorage().indices.filter(
			(i) => i.target === UsageDeckRowEntity,
		);
		const rankIndex = indices.find((i) => i.name === "idx_usage_deck_rows_rank");
		expect(rankIndex).toBeDefined();

		const relations = getMetadataArgsStorage().relations.filter(
			(r) => r.target === UsageDeckRowEntity,
		);
		expect(relations).toHaveLength(0);
	});

	it("configures UsageCardRowEntity with composite primary key, rank index, checks, and no foreign keys", () => {
		const tables = getMetadataArgsStorage().tables.filter((t) => t.target === UsageCardRowEntity);
		expect(tables[0]?.name).toBe("usage_card_rows");

		const columns = getMetadataArgsStorage().columns.filter(
			(c) => c.target === UsageCardRowEntity,
		);
		const colNames = columns.map((c) => c.options.name || c.propertyName);
		expect(colNames).toContain("format_id");
		expect(colNames).toContain("window_start");
		expect(colNames).toContain("metric");
		expect(colNames).toContain("card_id");
		expect(colNames).toContain("deck_count");
		expect(colNames).toContain("copies_1");
		expect(colNames).toContain("copies_2");
		expect(colNames).toContain("copies_3");

		const pks = columns.filter((c) => c.options.primary);
		const pkNames = pks.map((c) => c.options.name || c.propertyName);
		expect(pkNames).toEqual(
			expect.arrayContaining(["format_id", "window_start", "metric", "card_id"]),
		);
		expect(pkNames).toHaveLength(4);

		const checks = getMetadataArgsStorage().checks.filter(
			(c) => c.target === UsageCardRowEntity,
		);
		const checkExpressions = checks.map((c) => c.expression);
		expect(checkExpressions).toContain("format_id IN ('1103', '1109')");
		expect(checkExpressions).toContain(
			"metric IN ('monster', 'spell', 'trap', 'extra', 'side')",
		);
		expect(checkExpressions).toContain("card_id > 0");
		expect(checkExpressions).toContain("deck_count > 0");
		expect(checkExpressions).toContain("copies_1 >= 0");
		expect(checkExpressions).toContain("copies_2 >= 0");
		expect(checkExpressions).toContain("copies_3 >= 0");
		expect(checkExpressions).toContain(
			"EXTRACT(DAY FROM window_start) = 1 AND EXTRACT(MONTH FROM window_start) IN (1, 7)",
		);
		expect(checkExpressions).toContain("copies_1 + copies_2 + copies_3 = deck_count");

		const indices = getMetadataArgsStorage().indices.filter(
			(i) => i.target === UsageCardRowEntity,
		);
		const rankIndex = indices.find((i) => i.name === "idx_usage_card_rows_rank");
		expect(rankIndex).toBeDefined();

		const relations = getMetadataArgsStorage().relations.filter(
			(r) => r.target === UsageCardRowEntity,
		);
		expect(relations).toHaveLength(0);
	});
});
