import { Check, Column, Entity, PrimaryColumn, Unique } from "typeorm";

@Entity({
	name: "deck_types",
})
@Unique("uq_deck_types_format_sort", ["formatId", "sortOrder"])
@Check("ck_deck_types_sort_order", "sort_order >= 0")
export class DeckTypeEntity {
	@PrimaryColumn({ name: "format_id", type: "varchar", length: 16 })
	formatId: string;

	@PrimaryColumn({ name: "code", type: "varchar", length: 64 })
	code: string;

	@Column({ name: "name_zh", type: "varchar", length: 64 })
	nameZh: string;

	@Column({ name: "sort_order", type: "integer" })
	sortOrder: number;
}
