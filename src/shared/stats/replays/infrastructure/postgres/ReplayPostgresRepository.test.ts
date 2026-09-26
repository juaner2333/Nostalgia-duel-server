import { ReplayPostgresRepository, escapeLike } from "./ReplayPostgresRepository";
import { dataSource } from "../../../../../evolution-types/src/data-source";

jest.mock("../../../../../evolution-types/src/data-source", () => ({
	dataSource: {
		query: jest.fn(),
	},
}));

describe("ReplayPostgresRepository", () => {
	let repository: ReplayPostgresRepository;

	beforeEach(() => {
		jest.clearAllMocks();
		repository = new ReplayPostgresRepository();
	});

	it("escapes LIKE special characters (% and _ and \\)", () => {
		expect(escapeLike("normal")).toBe("normal");
		expect(escapeLike("100%_win\\rate")).toBe("100\\%\\_win\\\\rate");
	});

	it("queries replay list with pagination, search, and attaches deck metadata", async () => {
		// 1. COUNT
		(dataSource.query as jest.Mock).mockResolvedValueOnce([{ total: 1 }]);
		// 2. Data
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				replayId: "rep-1",
				duelIndex: 2,
				endedAt: new Date("2026-09-02T16:00:00Z"),
				size: 1024,
			},
		]);
		// 3. Batch duels + decks
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				replayId: "rep-1",
				duelId: "d-1",
				userId: "u-1",
				matchId: "m-1",
				playerNames: "Alice",
				opponentNames: "Bob",
				matchFormatId: "1109",
				matchAnulled: false,
				matchDeletedAt: null,
				deckTypeCode: "D01",
				deckTypeNameZh: "代行天使",
				isSideNull: false,
				snapshotSource: "online",
			},
			{
				replayId: "rep-1",
				duelId: "d-2",
				userId: "u-2",
				matchId: "m-2",
				playerNames: "Bob",
				opponentNames: "Alice",
				matchFormatId: "1109",
				matchAnulled: false,
				matchDeletedAt: null,
				deckTypeCode: "D02",
				deckTypeNameZh: "HB",
				isSideNull: false,
				snapshotSource: "online",
			},
		]);

		const res = await repository.getReplayList({
			formatId: "1109",
			page: 1,
			pageSize: 20,
			search: "Alice",
		});

		expect(res.total).toBe(1);
		expect(res.replays).toHaveLength(1);
		const item = res.replays[0];
		expect(item.replayId).toBe("rep-1");
		expect(item.duelIndex).toBe(2);
		expect(item.player1Name).toBe("Alice");
		expect(item.player2Name).toBe("Bob");
		expect(item.size).toBe(1024);
		expect(item.players).toHaveLength(2);
		expect(item.players[0]).toEqual({
			name: "Alice",
			deckTypeCode: "D01",
			deckTypeNameZh: "代行天使",
			deckCompleteness: "complete",
			deckDownloadUrl: "/api/ladder/1109/matches/m-1/deck",
		});
		expect(item.players[1]).toEqual({
			name: "Bob",
			deckTypeCode: "D02",
			deckTypeNameZh: "HB",
			deckCompleteness: "complete",
			deckDownloadUrl: "/api/ladder/1109/matches/m-2/deck",
		});

		expect(dataSource.query).toHaveBeenCalledTimes(3);
		// Check that the search query checks duels and deleted_at
		const countQuery = (dataSource.query as jest.Mock).mock.calls[0][0];
		expect(countQuery).toContain("AND EXISTS");
		expect(countQuery).toContain("ILIKE");
		expect(countQuery).toContain("d.deleted_at IS NULL");
	});

	it("filters by deckTypeCode in count and data queries", async () => {
		(dataSource.query as jest.Mock).mockResolvedValueOnce([{ total: 1 }]);
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				replayId: "rep-1",
				duelIndex: 1,
				endedAt: new Date("2026-09-02T16:00:00Z"),
				size: 1024,
			},
		]);
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				replayId: "rep-1",
				duelId: "d-1",
				userId: "u-1",
				matchId: "m-1",
				playerNames: "Alice",
				opponentNames: "Bob",
				matchFormatId: "1109",
				matchAnulled: false,
				matchDeletedAt: null,
				deckTypeCode: "D01",
				deckTypeNameZh: "代行天使",
				isSideNull: false,
				snapshotSource: "online",
			},
			{
				replayId: "rep-1",
				duelId: "d-2",
				userId: "u-2",
				matchId: "m-2",
				playerNames: "Bob",
				opponentNames: "Alice",
				matchFormatId: "1109",
				matchAnulled: false,
				matchDeletedAt: null,
				deckTypeCode: "D02",
				deckTypeNameZh: "HB",
				isSideNull: false,
				snapshotSource: "online",
			},
		]);

		const res = await repository.getReplayList({
			formatId: "1109",
			page: 1,
			pageSize: 20,
			deckTypeCode: "D01",
		});

		expect(res.total).toBe(1);
		const countQuery = (dataSource.query as jest.Mock).mock.calls[0][0];
		expect(countQuery).toContain("match_decks");
		expect(countQuery).toContain("md.deck_type_code = $");
		expect(countQuery).toContain("m.anulled = false");
		expect(countQuery).toContain("m.deleted_at IS NULL");
	});

	it("combines search and deckTypeCode into intersection", async () => {
		(dataSource.query as jest.Mock).mockResolvedValueOnce([{ total: 0 }]);

		const res = await repository.getReplayList({
			formatId: "1109",
			page: 1,
			pageSize: 20,
			search: "Alice",
			deckTypeCode: "D01",
		});

		expect(res.total).toBe(0);
		expect(res.replays).toEqual([]);
		const countQuery = (dataSource.query as jest.Mock).mock.calls[0][0];
		// Both conditions exist in WHERE
		expect(countQuery).toContain("ILIKE");
		expect(countQuery).toContain("md.deck_type_code = $");
		// Data and batch queries are skipped when total is 0
		expect(dataSource.query).toHaveBeenCalledTimes(1);
	});

	it("filters out annulled and soft-deleted matches", async () => {
		(dataSource.query as jest.Mock).mockResolvedValueOnce([{ total: 0 }]);

		await repository.getReplayList({
			formatId: "1103",
			page: 1,
			pageSize: 20,
		});

		const countQuery = (dataSource.query as jest.Mock).mock.calls[0][0];
		expect(countQuery).toContain("NOT EXISTS");
		expect(countQuery).toContain("m.anulled = true");
		expect(countQuery).toContain("m.deleted_at IS NOT NULL");
	});

	it("handles one player missing deck snapshot and historical partial deck", async () => {
		(dataSource.query as jest.Mock).mockResolvedValueOnce([{ total: 1 }]);
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				replayId: "rep-partial",
				duelIndex: 1,
				endedAt: new Date("2026-09-02T16:00:00Z"),
				size: 1024,
			},
		]);
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				replayId: "rep-partial",
				duelId: "d-1",
				userId: "u-1",
				matchId: "m-1",
				playerNames: "Alice",
				opponentNames: "Bob",
				matchFormatId: "1109",
				matchAnulled: false,
				matchDeletedAt: null,
				deckTypeCode: "D01",
				deckTypeNameZh: "代行天使",
				isSideNull: true, // historical backfill without side
				snapshotSource: "replay_backfill",
			},
			{
				replayId: "rep-partial",
				duelId: "d-2",
				userId: "u-2",
				matchId: "m-2",
				playerNames: "Bob",
				opponentNames: "Alice",
				matchFormatId: "1109",
				matchAnulled: false,
				matchDeletedAt: null,
				deckTypeCode: null, // missing deck snapshot
				deckTypeNameZh: null,
				isSideNull: null,
				snapshotSource: null,
			},
		]);

		const res = await repository.getReplayList({
			formatId: "1109",
			page: 1,
			pageSize: 20,
		});

		expect(res.replays[0].players[0]).toEqual({
			name: "Alice",
			deckTypeCode: "D01",
			deckTypeNameZh: "代行天使",
			deckCompleteness: "partial",
			deckDownloadUrl: "/api/ladder/1109/matches/m-1/deck",
		});
		expect(res.replays[0].players[1]).toEqual({
			name: "Bob",
			deckTypeCode: null,
			deckTypeNameZh: null,
			deckCompleteness: null,
			deckDownloadUrl: null,
		});
	});

	it("marks decks as unknown when there is ambiguity in duel perspectives", async () => {
		(dataSource.query as jest.Mock).mockResolvedValueOnce([{ total: 1 }]);
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				replayId: "rep-ambiguous",
				duelIndex: 1,
				endedAt: new Date("2026-09-02T16:00:00Z"),
				size: 1024,
			},
		]);
		// Only 1 duel perspective found
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				replayId: "rep-ambiguous",
				duelId: "d-1",
				userId: "u-1",
				matchId: "m-1",
				playerNames: "Alice",
				opponentNames: "Bob",
				matchFormatId: "1109",
				matchAnulled: false,
				matchDeletedAt: null,
				deckTypeCode: "D01",
				deckTypeNameZh: "代行天使",
				isSideNull: false,
				snapshotSource: "online",
			},
		]);

		const res = await repository.getReplayList({
			formatId: "1109",
			page: 1,
			pageSize: 20,
		});

		expect(res.replays[0].player1Name).toBe("Alice");
		expect(res.replays[0].player2Name).toBe("Bob");
		// Due to ambiguity, both deck info must be null
		expect(res.replays[0].players[0]).toEqual({
			name: "Alice",
			deckTypeCode: null,
			deckTypeNameZh: null,
			deckCompleteness: null,
			deckDownloadUrl: null,
		});
		expect(res.replays[0].players[1]).toEqual({
			name: "Bob",
			deckTypeCode: null,
			deckTypeNameZh: null,
			deckCompleteness: null,
			deckDownloadUrl: null,
		});
	});

	it("queries replay by ID and formatId without modification to replay bytea", async () => {
		const fakeBuffer = Buffer.from("replay-binary");
		(dataSource.query as jest.Mock).mockResolvedValueOnce([
			{
				replayId: "rep-1",
				formatId: "1103",
				endedAt: new Date("2026-09-02T16:00:00Z"),
				replayData: fakeBuffer,
				playerNames: "Alice",
				opponentNames: "Bob",
			},
		]);

		const res = await repository.getReplayById("1103", "rep-1");

		expect(res).not.toBeNull();
		expect(res?.replayId).toBe("rep-1");
		expect(res?.replayData).toEqual(fakeBuffer);
		expect(res?.player1Name).toBe("Alice");
		expect(res?.player2Name).toBe("Bob");
	});

	it("returns null when replay is not found", async () => {
		(dataSource.query as jest.Mock).mockResolvedValueOnce([]);

		const res = await repository.getReplayById("1103", "unknown");

		expect(res).toBeNull();
	});
});
