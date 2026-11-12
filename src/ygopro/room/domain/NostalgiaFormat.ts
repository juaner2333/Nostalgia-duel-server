import { GameMode } from "ygopro-msg-encode";

export const NOSTALGIA_FORMAT_IDS = Object.freeze(["1103", "1109", "goat"] as const);

export type NostalgiaResourceProfile = "2011" | "goat";
export type NostalgiaFormatId = (typeof NOSTALGIA_FORMAT_IDS)[number] | "goat";

const GOAT_FORMAT_IDS = Object.freeze(["goat"] as const);

export function getActiveNostalgiaFormatIds(
	profile: NostalgiaResourceProfile = "2011",
): readonly NostalgiaFormatId[] {
	return profile === "goat" ? GOAT_FORMAT_IDS : NOSTALGIA_FORMAT_IDS;
}

export interface NostalgiaFormat {
	readonly id: NostalgiaFormatId;
	readonly rule: 0 | 1;
	readonly duelRule: 1 | 2;
	readonly mode: GameMode.MATCH;
	readonly startLp: 8000;
	readonly bestOf: 3;
	readonly banListName: string;
}

const formats: Readonly<Record<NostalgiaFormatId, NostalgiaFormat>> = Object.freeze({
	"1103": Object.freeze({
		id: "1103",
		rule: 0,
		duelRule: 2,
		mode: GameMode.MATCH,
		startLp: 8000,
		bestOf: 3,
		banListName: "OCG 1103",
	}),
	"1109": Object.freeze({
		id: "1109",
		rule: 0,
		duelRule: 2,
		mode: GameMode.MATCH,
		startLp: 8000,
		bestOf: 3,
		banListName: "OCG 1109",
	}),
	goat: Object.freeze({
		id: "goat",
		rule: 1,
		duelRule: 1,
		mode: GameMode.MATCH,
		startLp: 8000,
		bestOf: 3,
		banListName: "2005.04.01 W/O Exarion",
	}),
});

export function getNostalgiaFormat(formatId: string): NostalgiaFormat | null {
	return Object.hasOwn(formats, formatId) ? formats[formatId as NostalgiaFormatId] : null;
}
