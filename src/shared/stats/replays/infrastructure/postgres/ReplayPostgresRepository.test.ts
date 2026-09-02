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

	it("queries replay list with pagination and search", async () => {
		(dataSource.query as jest.Mock).mockResolvedValueOnce([{ total: 1 }]).mockResolvedValueOnce([
			{
				replayId: "rep-1",
				endedAt: new Date("2026-09-02T16:00:00Z"),
				size: 1024,
				playerNames: "Alice",
				opponentNames: "Bob",
			},
		]);

		const res = await repository.getReplayList({
			formatId: "1103",
			page: 1,
			pageSize: 20,
			search: "Alice",
		});

		expect(res.total).toBe(1);
		expect(res.replays).toHaveLength(1);
		expect(res.replays[0].replayId).toBe("rep-1");
		expect(res.replays[0].player1Name).toBe("Alice");
		expect(res.replays[0].player2Name).toBe("Bob");
		expect(res.replays[0].size).toBe(1024);
		expect(dataSource.query).toHaveBeenCalledTimes(2);
	});

	it("queries replay by ID and formatId", async () => {
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
