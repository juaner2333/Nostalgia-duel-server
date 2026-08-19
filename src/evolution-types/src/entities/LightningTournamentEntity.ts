import {
	Column,
	CreateDateColumn,
	Entity,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";

import { TournamentEntity } from "./TournamentEntity";

@Entity({ name: "lightning_tournaments" })
export class LightningTournamentEntity {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column({ name: "tournament_id" })
	tournamentId: string;

	@ManyToOne(() => TournamentEntity)
	@JoinColumn({ name: "tournament_id" })
	tournament: TournamentEntity;

	@Column()
	season: string;

	@Column({ name: "completed_at", type: "timestamp", nullable: true })
	completedAt?: Date;

	@CreateDateColumn({ name: "created_at" })
	createdAt: Date;

	@UpdateDateColumn({ name: "updated_at" })
	updatedAt: Date;
}
