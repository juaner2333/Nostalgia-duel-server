import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("user_achievements")
export class UserAchievementEntity {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column({ name: "user_id" })
	userId: string;

	@Column({ name: "achievement_id" })
	achievementId: number;

	@Column({ name: "labels", type: "json" })
	labels: string[];

	@Column({ name: "unlocked_at" })
	unlockedAt: Date;

	@Column()
	season: number;
}
