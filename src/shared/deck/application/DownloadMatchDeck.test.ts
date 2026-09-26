import { DownloadMatchDeck } from "./DownloadMatchDeck";
import { MatchDeckRepository, MatchDeckDetails } from "../domain/MatchDeckRepository";

describe("DownloadMatchDeck use case", () => {
	let downloadMatchDeck: DownloadMatchDeck;
	let mockRepo: jest.Mocked<MatchDeckRepository>;

	beforeEach(() => {
		mockRepo = {
			findByMatchId: jest.fn(),
		};
		downloadMatchDeck = new DownloadMatchDeck(mockRepo);
	});

	it("returns formatted YDK and metadata for a complete deck", async () => {
		const matchDate = new Date("2026-09-02T12:00:00Z");
		const mockDetails: MatchDeckDetails = {
			matchId: "m-101",
			formatId: "1109",
			date: matchDate,
			playerName: "Alice",
			opponentName: "Bob",
			mainCards: [46986414, 33398782],
			extraCards: [83764718],
			sideCards: [18964575],
			completeness: "complete",
		};
		mockRepo.findByMatchId.mockResolvedValueOnce(mockDetails);

		const result = await downloadMatchDeck.run({
			format: "1109",
			matchId: "m-101",
		});

		expect(result.matchId).toBe("m-101");
		expect(result.formatId).toBe("1109");
		expect(result.completeness).toBe("complete");
		expect(result.filename).toContain("Alice VS Bob (complete).ydk");
		expect(result.safeAsciiFilename).toBe("match-m-101-complete.ydk");
		expect(result.ydkContent).toBe(
			"#main\r\n46986414\r\n33398782\r\n#extra\r\n83764718\r\n!side\r\n18964575\r\n",
		);
		// Verify no sensitive fields returned
		expect(result).not.toHaveProperty("userId");
		expect(result).not.toHaveProperty("ipAddress");
	});

	it("returns partial completeness and partial filename when sideCards is null", async () => {
		const matchDate = new Date("2026-09-02T12:00:00Z");
		const mockDetails: MatchDeckDetails = {
			matchId: "m-102",
			formatId: "1103",
			date: matchDate,
			playerName: "Charlie",
			opponentName: "Dave",
			mainCards: [46986414],
			extraCards: [],
			sideCards: null,
			completeness: "partial",
		};
		mockRepo.findByMatchId.mockResolvedValueOnce(mockDetails);

		const result = await downloadMatchDeck.run({
			format: "1103",
			matchId: "m-102",
		});

		expect(result.completeness).toBe("partial");
		expect(result.filename).toContain("(partial).ydk");
		expect(result.safeAsciiFilename).toBe("match-m-102-partial.ydk");
		expect(result.ydkContent).toBe("#main\r\n46986414\r\n#extra\r\n!side\r\n");
	});

	it("throws not found when match deck is not found or null", async () => {
		mockRepo.findByMatchId.mockResolvedValueOnce(null);

		await expect(
			downloadMatchDeck.run({
				format: "1109",
				matchId: "unknown-match",
			}),
		).rejects.toThrow("Match deck snapshot not found");
	});

	it("rejects unsupported format", async () => {
		await expect(
			downloadMatchDeck.run({
				format: "9999",
				matchId: "m-101",
			}),
		).rejects.toThrow("Invalid format");
	});
});
