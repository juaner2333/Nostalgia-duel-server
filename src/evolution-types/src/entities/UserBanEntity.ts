import {
	Column,
	CreateDateColumn,
	Entity,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";

import { UserProfileEntity } from "./UserProfileEntity";

@Entity({ name: "user_bans" })
export class UserBanEntity {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@ManyToOne(() => UserProfileEntity, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id" })
	user: UserProfileEntity;

	@Column("text")
	reason: string;

	@Column({ type: "timestamptz", name: "banned_at" })
	bannedAt: Date;

	@Column({ type: "timestamptz", name: "expires_at", nullable: true })
	expiresAt?: Date;

	@ManyToOne(() => UserProfileEntity, { onDelete: "SET NULL" })
	@JoinColumn({ name: "banned_by" })
	bannedBy: UserProfileEntity;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt: Date;
}
