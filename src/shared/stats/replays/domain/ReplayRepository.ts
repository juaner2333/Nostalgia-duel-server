import { ReplayFile, ReplayItem } from "./Replay";

export interface GetReplaysFilter {
	formatId: string;
	page: number;
	pageSize: number;
	search?: string;
}

export interface ReplayRepository {
	getReplayList(filter: GetReplaysFilter): Promise<{ replays: ReplayItem[]; total: number }>;
	getReplayById(formatId: string, replayId: string): Promise<ReplayFile | null>;
}
