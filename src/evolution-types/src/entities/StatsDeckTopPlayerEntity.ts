import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { UsageStatRunEntity } from "./UsageStatRunEntity";

@Entity({
	name: "stats_deck_top_players",
	comment: "按赛制和自然半年保存各具名卡组专精玩家胜率 Top10",
})
@Check("ck_stats_deck_top_players_format", "format_id = '1109'")
@Check("ck_stats_deck_top_players_rank", "rank BETWEEN 1 AND 10")
@Check("ck_stats_deck_top_players_matches", "matches >= 25")
@Check("ck_stats_deck_top_players_record_sum", "matches = wins + losses")
@Check("ck_stats_deck_top_players_win_rate", "win_rate >= 0.0 AND win_rate <= 1.0")
export class StatsDeckTopPlayerEntity {
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
		comment: "自然半年北京时间起始日期",
	})
	public windowStart: string;

	@PrimaryColumn({
		name: "deck_type_code",
		type: "varchar",
		length: 64,
		comment: "本方具名卡组代码",
	})
	public deckTypeCode: string;

	@PrimaryColumn({
		name: "rank",
		type: "smallint",
		comment: "玩家在当前卡组中的名次（1~10）",
	})
	public rank: number;

	@Column({
		name: "user_id",
		type: "varchar",
		length: 64,
		comment: "用户系统内部唯一标识",
	})
	public userId: string;

	@Column({
		name: "username",
		type: "varchar",
		length: 64,
		comment: "用户公开昵称",
	})
	public username: string;

	@Column({
		name: "matches",
		type: "integer",
		comment: "该卡组有效 Match 总场数（门槛 >= 25）",
	})
	public matches: number;

	@Column({
		name: "wins",
		type: "integer",
		comment: "该卡组 Match 胜场数",
	})
	public wins: number;

	@Column({
		name: "losses",
		type: "integer",
		comment: "该卡组 Match 负场数",
	})
	public losses: number;

	@Column({
		name: "win_rate",
		type: "double precision",
		comment: "完整精度胜率（wins / matches）",
	})
	public winRate: number;

	@ManyToOne(() => UsageStatRunEntity, { onDelete: "CASCADE" })
	@JoinColumn([
		{ name: "format_id", referencedColumnName: "formatId" },
		{ name: "window_start", referencedColumnName: "windowStart" },
	])
	public run?: UsageStatRunEntity;
}
