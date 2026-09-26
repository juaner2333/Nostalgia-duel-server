import { MatchDeckPostgresRepository } from "./MatchDeckPostgresRepository";
import { dataSource } from "../../../../evolution-types/src/data-source";

jest.mock("../../../../evolution-types/src/data-source", () => ({
	dataSource: {
		query: jest.fn(),
	},
}));

describe("MatchDeckPostgresRepository", () => {
	let repository: MatchDeckPostgresRepository;

	beforeEach(() => {
		jest.clearAllMocks();
		repository = new MatchDeckPostgresRepository();
	});

	it("returns match deck details for valid match and complete snapshot", async () => {
		const matchDate = new Date("2026-09-02T12:00:00Z");
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				matchId: "m-1",
				formatId: "1109",
				date: matchDate,
				playerNames: "Alice",
				opponentNames: "Bob",
				mainCards: [46986414, 33398782],
				extraCards: [83764718],
				sideCards: [18964575],
			},
		]);

		const res = await repository.findByMatchId("1109", "m-1");

		expect(res).not.toBeNull();
		expect(res?.matchId).toBe("m-1");
		expect(res?.formatId).toBe("1109");
		expect(res?.playerName).toBe("Alice");
		expect(res?.opponentName).toBe("Bob");
		expect(res?.completeness).toBe("complete");
		expect(res?.mainCards).toEqual([46986414, 33398782]);
		expect(res?.extraCards).toEqual([83764718]);
		expect(res?.sideCards).toEqual([18964575]);
		// Ensure no account sensitive columns
		expect(res).not.toHaveProperty("userId");
		expect(res).not.toHaveProperty("user_id");

		const sql = (dataSource.query as jest.Mock).mock.calls[0][0];
		expect(sql).toContain("m.anulled = false");
		expect(sql).toContain("m.deleted_at IS NULL");
	});

	it("returns partial completeness when side_cards is null", async () => {
		const matchDate = new Date("2026-09-02T12:00:00Z");
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				matchId: "m-2",
				formatId: "1103",
				date: matchDate,
				playerNames: "Charlie",
				opponentNames: "Dave",
				mainCards: [46986414],
				extraCards: [],
				sideCards: null,
			},
		]);

		const res = await repository.findByMatchId("1103", "m-2");

		expect(res).not.toBeNull();
		expect(res?.completeness).toBe("partial");
		expect(res?.sideCards).toBeNull();
	});

	it("returns null when match or snapshot does not exist", async () => {
		(dataSource.query as jest.Mock).mockResolvedValueOnce([]);

		const res = await repository.findByMatchId("1109", "non-existent");

		expect(res).toBeNull();
	});
});
