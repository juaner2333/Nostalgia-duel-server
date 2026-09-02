import {
	Column,
	CreateDateColumn,
	DeleteDateColumn,
	Entity,
	Index,
	PrimaryColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

@Entity({
	name: "duels",
})
@Unique("UQ_duels_user_replay", ["userId", "replayId"])
@Index("IDX_duels_replay", ["replayId"])
export class DuelResumeEntity {
	@PrimaryColumn()
	id: string;

	@Column({ name: "user_id" })
	userId: string;

	@Column({ name: "game_id", type: "uuid" })
	gameId: string;

	@Column({ name: "replay_id", type: "uuid" })
	replayId: string;

	@Column({ name: "player_names", type: "simple-array" })
	playerNames: string[];

	@Column({ name: "opponent_names", type: "simple-array" })
	opponentNames: string[];

	@Column()
	date: Date;

	@Column({ name: "ban_list_name" })
	banListName: string;

	@Column({ name: "ban_list_hash" })
	banListHash: string;

	@Column()
	result: string;

	@Column()
	turns: number;

	@Column({ name: "match_id" })
	matchId: string;

	@Column()
	season: number;

	@Column({ name: "ip_address", type: "varchar", nullable: true, default: null })
	ipAddress: string | null;

	@CreateDateColumn({ name: "created_at" })
	createdAt: Date;

	@UpdateDateColumn({ name: "updated_at" })
	updatedAt: Date;

	@DeleteDateColumn({ name: "deleted_at", nullable: true })
	deletedAt: Date | null;
}
