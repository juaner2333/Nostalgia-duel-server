import { Check, Column, Entity, Index, PrimaryColumn } from "typeorm";

export type UsageCardMetric = "monster" | "spell" | "trap" | "extra" | "side";

@Entity({
	name: "usage_card_rows",
	comment: "每个环境、自然半年、卡片指标和归一卡片的采用份数及投入张数分布",
})
@Index("idx_usage_card_rows_rank", ["formatId", "windowStart", "metric", "deckCount", "cardId"])
@Check("ck_usage_card_rows_format_id", "format_id IN ('1103', '1109')")
@Check(
	"ck_usage_card_rows_metric",
	"metric IN ('monster', 'spell', 'trap', 'extra', 'side')",
)
@Check("ck_usage_card_rows_card_id", "card_id > 0")
@Check("ck_usage_card_rows_deck_count", "deck_count > 0")
@Check("ck_usage_card_rows_copies_1", "copies_1 >= 0")
@Check("ck_usage_card_rows_copies_2", "copies_2 >= 0")
@Check("ck_usage_card_rows_copies_3", "copies_3 >= 0")
@Check(
	"ck_usage_card_rows_window_start",
	"EXTRACT(DAY FROM window_start) = 1 AND EXTRACT(MONTH FROM window_start) IN (1, 7)",
)
@Check("ck_usage_card_rows_copies_sum", "copies_1 + copies_2 + copies_3 = deck_count")
export class UsageCardRowEntity {
	@PrimaryColumn({
		name: "format_id",
		type: "varchar",
		length: 16,
		comment: "赛制编号，与汇总批次的环境一致",
	})
	formatId: string;

	@PrimaryColumn({
		name: "window_start",
		type: "date",
		comment:
			"所属自然半年的北京时间开始日期，与 usage_stat_runs 共同定位汇总批次",
	})
	windowStart: string;

	@PrimaryColumn({
		name: "metric",
		type: "varchar",
		length: 16,
		comment:
			"卡片指标：monster、spell、trap 取初始 Main，extra 取初始 Extra，side 取初始 Side",
	})
	metric: UsageCardMetric;

	@PrimaryColumn({
		name: "card_id",
		type: "integer",
		comment: "按固定卡片数据库的 alias 链归一后的卡片 ID",
	})
	cardId: number;

	@Column({
		name: "deck_count",
		type: "bigint",
		comment: "该指标中采用此卡的卡组份数，同一卡在一份卡组内只计一次",
		transformer: {
			to: (value: number | string) => value,
			from: (value: string | number) => Number(value),
		},
	})
	deckCount: number;

	@Column({
		name: "copies_1",
		type: "bigint",
		comment: "该指标中归一后恰好投入此卡 1 张的卡组份数",
		transformer: {
			to: (value: number | string) => value,
			from: (value: string | number) => Number(value),
		},
	})
	copies1: number;

	@Column({
		name: "copies_2",
		type: "bigint",
		comment: "该指标中归一后恰好投入此卡 2 张的卡组份数",
		transformer: {
			to: (value: number | string) => value,
			from: (value: string | number) => Number(value),
		},
	})
	copies2: number;

	@Column({
		name: "copies_3",
		type: "bigint",
		comment: "该指标中归一后恰好投入此卡 3 张的卡组份数",
		transformer: {
			to: (value: number | string) => value,
			from: (value: string | number) => Number(value),
		},
	})
	copies3: number;
}
