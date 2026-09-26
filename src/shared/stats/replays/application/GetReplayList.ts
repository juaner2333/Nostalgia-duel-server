import { ReplayRepository } from "../domain/ReplayRepository";
import {
	ReplayListResponse,
	SUPPORTED_REPLAY_FORMATS,
	SupportedReplayFormat,
} from "../domain/Replay";
import { DECK_TYPE_CATALOG } from "../../../deck/domain/classifier/DeckClassifier";

export interface GetReplayListRequest {
	format: string;
	page?: number;
	pageSize?: number;
	search?: string;
	deckTypeCode?: string;
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

		let deckTypeCode: string | undefined = undefined;
		if (request.deckTypeCode !== undefined) {
			const trimmed = request.deckTypeCode.trim();
			if (trimmed.length > 0) {
				const catalog = DECK_TYPE_CATALOG[request.format];
				if (!catalog || !catalog.some((item) => item.code === trimmed)) {
					throw new Error(`Invalid deck type code '${trimmed}' for format ${request.format}`);
				}
				deckTypeCode = trimmed;
			}
		}

		const { replays, total } = await this.repository.getReplayList({
			formatId: request.format,
			page,
			pageSize,
			search,
			deckTypeCode,
		});

		const deckTypes = (DECK_TYPE_CATALOG[request.format] ?? []).map((item) => ({
			code: item.code,
			nameZh: item.nameZh,
		}));

		return {
			format: request.format,
			page,
			pageSize,
			total,
			replays,
			deckTypes,
		};
	}
}
