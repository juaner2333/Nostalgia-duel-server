import { GameMode } from "ygopro-msg-encode";

export const NOSTALGIA_FORMAT_IDS = Object.freeze(["1103", "1109"] as const);

export type NostalgiaFormatId = (typeof NOSTALGIA_FORMAT_IDS)[number];

export interface NostalgiaFormat {
	readonly id: NostalgiaFormatId;
	readonly rule: 0;
	readonly duelRule: 2;
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
});

export function getNostalgiaFormat(formatId: string): NostalgiaFormat | null {
	return formats[formatId as NostalgiaFormatId] ?? null;
}
