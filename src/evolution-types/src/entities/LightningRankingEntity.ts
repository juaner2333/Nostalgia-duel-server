import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";

import { UserProfileEntity } from "./UserProfileEntity";

@Entity({ name: "lightning_rankings" })
@Index(["userId", "season"], { unique: true })
export class LightningRankingEntity {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column({ name: "user_id" })
	userId: string;

	@ManyToOne(() => UserProfileEntity)
	@JoinColumn({ name: "user_id" })
	user: UserProfileEntity;

	@Column({ default: 0 })
	points: number;

	@Column({ name: "tournaments_won", default: 0 })
	tournamentsWon: number;

	@Column({ name: "tournaments_played", default: 0 })
	tournamentsPlayed: number;

	@Column()
	season: string;

	@CreateDateColumn({ name: "created_at" })
	createdAt: Date;

	@UpdateDateColumn({ name: "updated_at" })
	updatedAt: Date;
}
