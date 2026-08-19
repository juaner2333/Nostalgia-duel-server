import { CardSearchRepository, CardSearchResult } from "../domain/CardSearchRepository";
import { SearchCards } from "./SearchCards";

class FakeCardSearchRepository implements CardSearchRepository {
	searchByNameCalls: Array<{ query: string; limit: number }> = [];
	findByIdCalls: number[] = [];

	constructor(private readonly cards: CardSearchResult[]) {}

	async searchByName(query: string, limit: number): Promise<CardSearchResult[]> {
		this.searchByNameCalls.push({ query, limit });

		return this.cards
			.filter((card) => card.name.toLowerCase().includes(query.toLowerCase()))
			.slice(0, limit);
	}

	async findById(id: number): Promise<CardSearchResult | null> {
		this.findByIdCalls.push(id);

		return this.cards.find((card) => card.id === id) ?? null;
	}
}

const buildService = () => {
	const repository = new FakeCardSearchRepository([
		{ id: 46986414, name: "Dark Magician", source: "cards.cdb" },
		{ id: 89631139, name: "Blue-Eyes White Dragon", source: "cards.cdb" },
	]);
	const service = new SearchCards(repository);

	return { service, repository };
};

describe("SearchCards", () => {
	it("returns an empty array for a blank query without hitting the repository", async () => {
		const { service, repository } = buildService();

		expect(await service.run({ query: "   " })).toEqual([]);
		expect(repository.searchByNameCalls).toHaveLength(0);
		expect(repository.findByIdCalls).toHaveLength(0);
	});

	it("searches by name and tags every result with the ygopro engine", async () => {
		const { service } = buildService();

		const results = await service.run({ query: "dark" });

		expect(results).toEqual([
			{ engine: "ygopro", id: 46986414, name: "Dark Magician", source: "cards.cdb" },
		]);
	});

	it("looks up by id when the query is numeric", async () => {
		const { service, repository } = buildService();

		const results = await service.run({ query: "89631139" });

		expect(results).toEqual([
			{ engine: "ygopro", id: 89631139, name: "Blue-Eyes White Dragon", source: "cards.cdb" },
		]);
		expect(repository.findByIdCalls).toEqual([89631139]);
		expect(repository.searchByNameCalls).toHaveLength(0);
	});

	it("clamps the limit to the maximum allowed", async () => {
		const { service, repository } = buildService();

		await service.run({ query: "dark", limit: 9999 });

		expect(repository.searchByNameCalls[0].limit).toBe(100);
	});

	it("falls back to the default limit when none is provided", async () => {
		const { service, repository } = buildService();

		await service.run({ query: "dark" });

		expect(repository.searchByNameCalls[0].limit).toBe(50);
	});
});
