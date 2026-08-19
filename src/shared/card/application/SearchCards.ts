import { CardSearchRepository, CardSearchResult } from "../domain/CardSearchRepository";

export interface CardSearchResultWithEngine extends CardSearchResult {
	engine: "ygopro";
}

export interface SearchCardsParams {
	query: string;
	limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export class SearchCards {
	constructor(private readonly repository: CardSearchRepository) {}

	async run(params: SearchCardsParams): Promise<CardSearchResultWithEngine[]> {
		const query = params.query.trim();
		if (!query) {
			return [];
		}

		const limit = this.normalizeLimit(params.limit);
		const found = await this.searchOne(this.repository, query, limit);

		return found.map((card) => ({ ...card, engine: "ygopro" as const }));
	}

	private async searchOne(
		repository: CardSearchRepository,
		query: string,
		limit: number,
	): Promise<CardSearchResult[]> {
		if (/^\d+$/.test(query)) {
			const card = await repository.findById(Number(query));

			return card ? [card] : [];
		}

		return repository.searchByName(query, limit);
	}

	private normalizeLimit(limit?: number): number {
		if (limit === undefined || Number.isNaN(limit) || limit < 1) {
			return DEFAULT_LIMIT;
		}

		return Math.min(Math.floor(limit), MAX_LIMIT);
	}
}
