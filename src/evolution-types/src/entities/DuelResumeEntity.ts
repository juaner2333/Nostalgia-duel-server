import {
	Check,
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
@Index("uq_duels_active_match_duel_index", ["matchId", "duelIndex"], {
	unique: true,
	where: "duel_index IS NOT NULL AND deleted_at IS NULL",
})
@Check("ck_duels_matchup_duel_index", "duel_index IS NULL OR duel_index BETWEEN 1 AND 3")
@Check("ck_duels_matchup_first_requires_index", "is_first IS NULL OR duel_index IS NOT NULL")
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

	@Column({ name: "duel_index", type: "smallint", nullable: true, default: null })
	duelIndex: number | null;

	@Column({ name: "is_first", type: "boolean", nullable: true, default: null })
	isFirst: boolean | null;

	@Column({ name: "ip_address", type: "varchar", nullable: true, default: null })
	ipAddress: string | null;

	@CreateDateColumn({ name: "created_at" })
	createdAt: Date;

	@UpdateDateColumn({ name: "updated_at" })
	updatedAt: Date;

	@DeleteDateColumn({ name: "deleted_at", nullable: true })
	deletedAt: Date | null;
}
