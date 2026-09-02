import { PlayerMatchSummary } from "src/shared/player/domain/Player";

export type GameOverReplayData = {
	duelIndex: number;
	replayData: Buffer;
	startedAt: Date;
	endedAt: Date;
};

export type GameOverData = {
	bestOf: number;
	date: Date;
	players: PlayerMatchSummary[];
	banListHash: number;
	banListName: string;
	ranked: boolean;
	formatId?: string;
	externalRoomId?: string;
	admissionKey?: string;
	replays?: GameOverReplayData[];
};

export class GameOverDomainEvent {
	static readonly DOMAIN_EVENT = "GAME_OVER";
	readonly data: GameOverData;

	constructor(data: GameOverData) {
		this.data = data;
	}
}
