import {
	Check,
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
} from "typeorm";

@Entity({
	name: "duel_replays",
})
@Unique("UQ_duel_replays_game_duel", ["gameId", "duelIndex"])
@Index("IDX_duel_replays_format_ended", ["formatId", "endedAt"])
@Check("CK_duel_replays_duel_index", `"duel_index" > 0`)
@Check("CK_duel_replays_time", `"ended_at" >= "started_at"`)
@Check("CK_duel_replays_data", `octet_length("replay_data") > 0`)
export class DuelReplayEntity {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column({ name: "game_id", type: "uuid" })
	gameId: string;

	@Column({ name: "duel_index", type: "smallint" })
	duelIndex: number;

	@Column({ name: "format_id" })
	formatId: string;

	@Column({ name: "ban_list_name" })
	banListName: string;

	@Column({ name: "ban_list_hash" })
	banListHash: string;

	@Column({ name: "replay_data", type: "bytea", select: false })
	replayData: Buffer;

	@Column({ name: "started_at", type: "timestamptz" })
	startedAt: Date;

	@Column({ name: "ended_at", type: "timestamptz" })
	endedAt: Date;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt: Date;
}
