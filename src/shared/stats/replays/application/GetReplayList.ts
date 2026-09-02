import { ReplayRepository } from "../domain/ReplayRepository";
import {
	ReplayListResponse,
	SUPPORTED_REPLAY_FORMATS,
	SupportedReplayFormat,
} from "../domain/Replay";

export interface GetReplayListRequest {
	format: string;
	page?: number;
	pageSize?: number;
	search?: string;
}

export class GetReplayList {
	constructor(private readonly repository: ReplayRepository) {}

	async run(request: GetReplayListRequest): Promise<ReplayListResponse> {
		if (!SUPPORTED_REPLAY_FORMATS.includes(request.format as SupportedReplayFormat)) {
			throw new Error(`Invalid format: ${request.format}`);
		}

		let page = Number(request.page);
		if (isNaN(page) || page < 1) {
			page = 1;
		}

		let pageSize = Number(request.pageSize);
		if (isNaN(pageSize) || pageSize < 1) {
			pageSize = 20;
		} else if (pageSize > 100) {
			pageSize = 100;
		}

		const search = request.search?.trim() ? request.search.trim() : undefined;

		const { replays, total } = await this.repository.getReplayList({
			formatId: request.format,
			page,
			pageSize,
			search,
		});

		return {
			format: request.format,
			page,
			pageSize,
			total,
			replays,
		};
	}
}
