import {
	Column,
	CreateDateColumn,
	DeleteDateColumn,
	Entity,
	PrimaryColumn,
	UpdateDateColumn,
} from "typeorm";

@Entity("achievements")
export class AchievementEntity {
	@PrimaryColumn()
	id: number;

	@Column()
	name: string;

	@Column()
	description: string;

	@Column()
	icon: string;

	@Column({ name: "earned_points" })
	earnedPoints: number;

	@CreateDateColumn({ name: "created_at" })
	createdAt: Date;

	@UpdateDateColumn({ name: "updated_at" })
	updatedAt: Date;

	@DeleteDateColumn({ name: "deleted_at", nullable: true })
	deletedAt: Date | null;
}
