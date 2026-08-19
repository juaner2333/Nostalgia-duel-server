import {
	Column,
	CreateDateColumn,
	DeleteDateColumn,
	Entity,
	JoinColumn,
	ManyToOne,
	PrimaryColumn,
	UpdateDateColumn,
} from "typeorm";

import { UserProfileEntity } from "./UserProfileEntity";

@Entity({
	name: "matches",
})
export class MatchResumeEntity {
	@PrimaryColumn()
	id: string;

	@Column({ name: "user_id" })
	userId: string;

	@Column({ name: "game_id" })
	gameId: string;

	@Column({ name: "best_of" })
	bestOf: number;

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

	@Column({ name: "player_score" })
	playerScore: number;

	@Column({ name: "opponent_score" })
	opponentScore: number;

	@Column()
	winner: boolean;

	@Column()
	season: number;

	@Column()
	points: number;

	@Column({ name: "player_ids", type: "simple-array", nullable: true })
	playerIds: string[] | null;

	@Column({ name: "opponent_ids", type: "simple-array", nullable: true })
	opponentIds: string[] | null;

	@Column({ default: false })
	anulled: boolean;

	@Column({ name: "anulled_user_id", nullable: true })
	anulledUserId: string | null;

	@ManyToOne(() => UserProfileEntity, { nullable: true })
	@JoinColumn({ name: "anulled_user_id" })
	anulledUser: UserProfileEntity | null;

	@Column({ name: "anulled_reason", nullable: true, type: "character varying" })
	anulledReason: string | null;

	@Column({ name: "anulled_by", nullable: true })
	anulledBy: string | null;

	@ManyToOne(() => UserProfileEntity, { nullable: true })
	@JoinColumn({ name: "anulled_by" })
	anulledByUser: UserProfileEntity | null;

	@CreateDateColumn({ name: "created_at" })
	createdAt: Date;

	@UpdateDateColumn({ name: "updated_at" })
	updatedAt: Date;

	@DeleteDateColumn({ name: "deleted_at", nullable: true })
	deletedAt: Date | null;
}
