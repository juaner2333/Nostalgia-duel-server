import { Check, Column, Entity, PrimaryColumn } from "typeorm";

@Entity({
	name: "usage_stat_runs",
	comment: "按赛制和自然半年保存一次完整发布的使用率统计及样本覆盖",
})
@Check("ck_usage_stat_runs_format_id", "format_id IN ('1103', '1109')")
@Check("ck_usage_stat_runs_total_decks", "total_decks >= 0")
@Check(
	"ck_usage_stat_runs_side_known_decks",
	"side_known_decks >= 0 AND side_known_decks <= total_decks",
)
@Check(
	"ck_usage_stat_runs_window_start",
	"EXTRACT(DAY FROM window_start) = 1 AND EXTRACT(MONTH FROM window_start) IN (1, 7)",
)
@Check(
	"ck_usage_stat_runs_window_end_exclusive",
	"window_end_exclusive = (window_start + INTERVAL '6 months')::date",
)
@Check(
	"ck_usage_stat_runs_data_end_exclusive",
	"data_end_exclusive BETWEEN window_start AND window_end_exclusive",
)
export class UsageStatRunEntity {
	@PrimaryColumn({
		name: "format_id",
		type: "varchar",
		length: 16,
		comment: "赛制编号，仅 1103 或 1109；两个环境独立统计",
	})
	formatId: string;

	@PrimaryColumn({
		name: "window_start",
		type: "date",
		comment:
			"所属自然半年的北京时间开始日期，包含当天；上半年为 1 月 1 日，下半年为 7 月 1 日",
	})
	windowStart: string;

	@Column({
		name: "window_end_exclusive",
		type: "date",
		comment:
			"所属自然半年的北京时间固定结束日期，不包含当天；上半年为 7 月 1 日，下半年为次年 1 月 1 日",
	})
	windowEndExclusive: string;

	@Column({
		name: "data_end_exclusive",
		type: "date",
		comment:
			"本次汇总实际覆盖到的北京时间截止日期，不包含当天；当前半年通常为任务运行日",
	})
	dataEndExclusive: string;

	@Column({
		name: "published_at",
		type: "timestamptz",
		comment: "本行及其卡组、卡片明细最近一次完整成功发布的时间",
	})
	publishedAt: Date;

	@Column({
		name: "total_decks",
		type: "bigint",
		comment:
			"从有效 matches 关联的可信 match_decks 快照计算的卡组份数；卡组榜及非 Side 卡片榜的分母",
		transformer: {
			to: (value: number | string) => value,
			from: (value: string | number) => Number(value),
		},
	})
	totalDecks: number;

	@Column({
		name: "side_known_decks",
		type: "bigint",
		comment:
			"上述可信 match_decks 中 side_cards 非 NULL 的份数，空数组也计入；Side 卡片榜的分母",
		transformer: {
			to: (value: number | string) => value,
			from: (value: string | number) => Number(value),
		},
	})
	sideKnownDecks: number;
}
