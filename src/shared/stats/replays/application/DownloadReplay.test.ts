import { DownloadReplay } from "./DownloadReplay";
import { ReplayRepository } from "../domain/ReplayRepository";

describe("DownloadReplay use case", () => {
	let downloadReplay: DownloadReplay;
	let mockRepo: jest.Mocked<ReplayRepository>;

	beforeEach(() => {
		mockRepo = {
			getReplayList: jest.fn(),
			getReplayById: jest.fn(),
		};
		downloadReplay = new DownloadReplay(mockRepo);
	});

	it("returns replay file and sanitized filename for valid replay", async () => {
		const replayData = Buffer.from("YRP3\x00\x00\x00\x00fake-replay-content");
		mockRepo.getReplayById.mockResolvedValue({
			replayId: "r-1",
			formatId: "1103",
			endedAt: new Date("2026-09-02T12:30:00Z"),
			player1Name: "Alice/King",
			player2Name: "Bob:Master",
			replayData,
		});

		const res = await downloadReplay.run({
			format: "1103",
			replayId: "r-1",
		});

		expect(res.replayData).toEqual(replayData);
		expect(res.filename).toContain("Alice_King VS Bob_Master.yrp");
		expect(res.filename).not.toContain("/");
		expect(res.filename).not.toContain(":");
	});

	it("rejects when format does not match or replay not found", async () => {
		mockRepo.getReplayById.mockResolvedValue(null);

		await expect(
			downloadReplay.run({
				format: "1103",
				replayId: "non-existent",
			}),
		).rejects.toThrow("Replay not found");
	});

	it("rejects unsupported format", async () => {
		await expect(
			downloadReplay.run({
				format: "invalid",
				replayId: "r-1",
			}),
		).rejects.toThrow("Invalid format");
	});
});
