import {
	Column,
	CreateDateColumn,
	Entity,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";

import { LightningTournamentEntity } from "./LightningTournamentEntity";
import { UserProfileEntity } from "./UserProfileEntity";

@Entity({ name: "lightning_results" })
export class LightningResultEntity {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column({ name: "lightning_tournament_id" })
	lightningTournamentId: string;

	@ManyToOne(() => LightningTournamentEntity)
	@JoinColumn({ name: "lightning_tournament_id" })
	lightningTournament: LightningTournamentEntity;

	@Column({ name: "user_id" })
	userId: string;

	@ManyToOne(() => UserProfileEntity)
	@JoinColumn({ name: "user_id" })
	user: UserProfileEntity;

	@Column()
	position: number; // 1 = first, 2 = second, etc.

	@Column({ name: "points_awarded" })
	pointsAwarded: number;

	@CreateDateColumn({ name: "created_at" })
	createdAt: Date;

	@UpdateDateColumn({ name: "updated_at" })
	updatedAt: Date;
}
