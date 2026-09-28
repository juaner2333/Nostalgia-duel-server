import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { DeckTypeEntity } from "./DeckTypeEntity";
import { UsageStatRunEntity } from "./UsageStatRunEntity";

@Entity({
	name: "stats_deck_matchups",
	comment: "仅 1109 半年度前 15 类之间的 G1 先攻卡组到后攻卡组的物理 Match 计数",
})
@Index("idx_stats_deck_matchups_second", [
	"formatId",
	"windowStart",
	"secondDeckCode",
	"firstDeckCode",
])
@Check("ck_stats_deck_matchups_format", "format_id = '1109'")
@Check(
	"ck_stats_deck_matchups_named_only",
	"first_deck_code <> 'OTHERS' AND second_deck_code <> 'OTHERS'",
)
@Check(
	"ck_stats_deck_matchups_counts",
	"match_count > 0 AND first_wins BETWEEN 0 AND match_count",
)
export class StatsDeckMatchupEntity {
	@PrimaryColumn({
		name: "format_id",
		type: "varchar",
		length: 16,
		comment: "赛制编号，仅限 1109",
	})
	formatId: string;

	@PrimaryColumn({
		name: "window_start",
		type: "date",
		comment: "所属自然半年的北京时间开始日期，与 usage_stat_runs 共同定位汇总批次",
	})
	windowStart: string;

	@PrimaryColumn({
		name: "first_deck_code",
		type: "varchar",
		length: 64,
		comment: "G1 先攻卡组分类代码，仅限入选前 15 的具名类型",
	})
	firstDeckCode: string;

	@PrimaryColumn({
		name: "second_deck_code",
		type: "varchar",
		length: 64,
		comment: "G1 后攻卡组分类代码，仅限入选前 15 的具名类型",
	})
	secondDeckCode: string;

	@Column({
		name: "match_count",
		type: "bigint",
		comment: "双方在该座次条件下的有效物理 Match 场数",
		transformer: {
			to: (value: number | string) => value,
			from: (value: string | number) => Number(value),
		},
	})
	matchCount: number;

	@Column({
		name: "first_wins",
		type: "bigint",
		comment: "该座次条件下 G1 先攻方赢得整场 Match 的场数",
		transformer: {
			to: (value: number | string) => value,
			from: (value: string | number) => Number(value),
		},
	})
	firstWins: number;

	@ManyToOne(() => UsageStatRunEntity)
	@JoinColumn([
		{ name: "format_id", referencedColumnName: "formatId" },
		{ name: "window_start", referencedColumnName: "windowStart" },
	])
	usageStatRun?: UsageStatRunEntity;

	@ManyToOne(() => DeckTypeEntity)
	@JoinColumn([
		{ name: "format_id", referencedColumnName: "formatId" },
		{ name: "first_deck_code", referencedColumnName: "code" },
	])
	firstDeckType?: DeckTypeEntity;

	@ManyToOne(() => DeckTypeEntity)
	@JoinColumn([
		{ name: "format_id", referencedColumnName: "formatId" },
		{ name: "second_deck_code", referencedColumnName: "code" },
	])
	secondDeckType?: DeckTypeEntity;
}
