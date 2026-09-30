import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { UsageStatRunEntity } from "./UsageStatRunEntity";

const bigintTransformer = {
	to: (value: number): number => value,
	from: (value: string | number): number => Number(value),
};

@Entity({
	name: "stats_deck_detail_matchups",
	comment: "按赛制和自然半年保存各具名卡组对阵全对手的 8 项严格守恒计数",
})
@Check("ck_stats_deck_detail_matchups_format", "format_id = '1109'")
@Check(
	"ck_stats_deck_detail_matchups_matches_sum",
	"matches = first_matches + second_matches + unknown_seat_matches",
)
@Check(
	"ck_stats_deck_detail_matchups_wins_sum",
	"match_wins = first_wins + second_wins + unknown_seat_wins",
)
export class StatsDeckDetailMatchupEntity {
	@PrimaryColumn({
		name: "format_id",
		type: "varchar",
		length: 16,
		comment: "赛制编号（仅 1109）",
	})
	public formatId: string;

	@PrimaryColumn({
		name: "window_start",
		type: "date",
		comment: "自然半年北京时间起始日期（1月1日或7月1日）",
	})
	public windowStart: string;

	@PrimaryColumn({
		name: "deck_type_code",
		type: "varchar",
		length: 64,
		comment: "本方具名卡组代码（D01~D30）",
	})
	public deckTypeCode: string;

	@PrimaryColumn({
		name: "opp_deck_type_code",
		type: "varchar",
		length: 64,
		comment: "对手卡组代码（D01~D30 或 unknown）",
	})
	public oppDeckTypeCode: string;

	@Column({
		name: "matches",
		type: "bigint",
		default: 0,
		comment: "Match 对阵总场数",
		transformer: bigintTransformer,
	})
	public matches: number;

	@Column({
		name: "match_wins",
		type: "bigint",
		default: 0,
		comment: "Match 胜场数",
		transformer: bigintTransformer,
	})
	public matchWins: number;

	@Column({
		name: "first_matches",
		type: "bigint",
		default: 0,
		comment: "G1 先手总场数",
		transformer: bigintTransformer,
	})
	public firstMatches: number;

	@Column({
		name: "first_wins",
		type: "bigint",
		default: 0,
		comment: "G1 先手胜场数",
		transformer: bigintTransformer,
	})
	public firstWins: number;

	@Column({
		name: "second_matches",
		type: "bigint",
		default: 0,
		comment: "G1 后手总场数",
		transformer: bigintTransformer,
	})
	public secondMatches: number;

	@Column({
		name: "second_wins",
		type: "bigint",
		default: 0,
		comment: "G1 后手胜场数",
		transformer: bigintTransformer,
	})
	public secondWins: number;

	@Column({
		name: "unknown_seat_matches",
		type: "bigint",
		default: 0,
		comment: "G1 座次未知场数",
		transformer: bigintTransformer,
	})
	public unknownSeatMatches: number;

	@Column({
		name: "unknown_seat_wins",
		type: "bigint",
		default: 0,
		comment: "G1 座次未知胜场数",
		transformer: bigintTransformer,
	})
	public unknownSeatWins: number;

	@ManyToOne(() => UsageStatRunEntity, { onDelete: "CASCADE" })
	@JoinColumn([
		{ name: "format_id", referencedColumnName: "formatId" },
		{ name: "window_start", referencedColumnName: "windowStart" },
	])
	public run?: UsageStatRunEntity;
}
