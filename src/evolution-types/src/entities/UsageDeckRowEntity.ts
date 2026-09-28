import { Check, Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity({
	name: "usage_deck_rows",
	comment: "每个环境、自然半年和卡组类型的使用份数",
})
@Index("idx_usage_deck_rows_rank", ["formatId", "windowStart", "deckCount", "deckTypeCode"])
@Check("ck_usage_deck_rows_format_id", "format_id IN ('1103', '1109')")
@Check("ck_usage_deck_rows_deck_count", "deck_count > 0")
@Check(
	"ck_usage_deck_rows_window_start",
	"EXTRACT(DAY FROM window_start) = 1 AND EXTRACT(MONTH FROM window_start) IN (1, 7)",
)
export class UsageDeckRowEntity {
	@PrimaryColumn({
		name: "format_id",
		type: "varchar",
		length: 16,
		comment: "赛制编号，与汇总批次及卡组类型目录的环境一致",
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
		name: "deck_type_code",
		type: "varchar",
		length: 64,
		comment: "环境内卡组分类代码，由统计任务对照 deck_types 目录校验，包含 OTHERS",
	})
	deckTypeCode: string;

	@Column({
		name: "deck_count",
		type: "bigint",
		comment:
			"有效初始卡组快照中被分为该类型的卡组份数，每份卡组只计一次",
		transformer: {
			to: (value: number | string) => value,
			from: (value: string | number) => Number(value),
		},
	})
	deckCount: number;
}
