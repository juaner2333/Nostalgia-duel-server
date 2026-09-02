export interface ReplayItem {
	replayId: string;
	endedAt: string;
	player1Name: string;
	player2Name: string;
	size: number;
}

export interface ReplayListResponse {
	format: string;
	page: number;
	pageSize: number;
	total: number;
	replays: ReplayItem[];
}

export interface ReplayFile {
	replayId: string;
	formatId: string;
	endedAt: Date;
	player1Name: string;
	player2Name: string;
	replayData: Buffer;
}

export const SUPPORTED_REPLAY_FORMATS = Object.freeze(["1103", "1109"] as const);
export type SupportedReplayFormat = (typeof SUPPORTED_REPLAY_FORMATS)[number];
