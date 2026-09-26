import {
	Check,
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	PrimaryColumn,
} from "typeorm";
import { DeckTypeEntity } from "./DeckTypeEntity";
import { MatchResumeEntity } from "./MatchResumeEntity";

export type MatchDeckSnapshotSource = "online" | "replay_backfill";

@Entity({
	name: "match_decks",
})
@Index("idx_match_decks_type_match", ["formatId", "deckTypeCode", "matchId"])
@Check("ck_match_decks_source", "snapshot_source IN ('online', 'replay_backfill')")
@Check("ck_match_decks_main_count", "cardinality(main_cards) BETWEEN 40 AND 60")
@Check("ck_match_decks_extra_count", "cardinality(extra_cards) BETWEEN 0 AND 15")
@Check(
	"ck_match_decks_side_count",
	"side_cards IS NULL OR cardinality(side_cards) BETWEEN 0 AND 15",
)
export class MatchDeckEntity {
	@PrimaryColumn({ name: "match_id", type: "varchar" })
	matchId: string;

	@Column({ name: "format_id", type: "varchar", length: 16 })
	formatId: string;

	@Column({ name: "deck_type_code", type: "varchar", length: 64 })
	deckTypeCode: string;

	@Column({ name: "classifier_version", type: "varchar", length: 64 })
	classifierVersion: string;

	@Column({ name: "snapshot_source", type: "varchar", length: 16 })
	snapshotSource: MatchDeckSnapshotSource;

	@Column("integer", { array: true, name: "main_cards" })
	mainCards: number[];

	@Column("integer", { array: true, name: "extra_cards" })
	extraCards: number[];

	@Column("integer", { array: true, name: "side_cards", nullable: true })
	sideCards: number[] | null;

	@ManyToOne(() => MatchResumeEntity)
	@JoinColumn([
		{ name: "match_id", referencedColumnName: "id" },
		{ name: "format_id", referencedColumnName: "formatId" },
	])
	match?: MatchResumeEntity;

	@ManyToOne(() => DeckTypeEntity)
	@JoinColumn([
		{ name: "format_id", referencedColumnName: "formatId" },
		{ name: "deck_type_code", referencedColumnName: "code" },
	])
	deckType?: DeckTypeEntity;
}
