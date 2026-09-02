import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from "typeorm";

@Entity("player_stats")
@Unique("UQ_player_stats_user_format_season", ["userId", "formatId", "season"])
@Index("IDX_player_stats_month", ["formatId", "season", "points", "wins"])
@Index("IDX_player_stats_overall", ["formatId", "userId"])
export class PlayerStatsEntity {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column({ name: "ban_list_name" })
	banListName: string;

	@Column({ name: "format_id" })
	formatId: string;

	@Column()
	wins: number;

	@Column()
	losses: number;

	@Column()
	points: number;

	@Column({ name: "user_id" })
	userId: string;

	@Column()
	season: number;
}
