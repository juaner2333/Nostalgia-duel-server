import { GetReplayList } from "./GetReplayList";
import { ReplayRepository } from "../domain/ReplayRepository";

describe("GetReplayList use case", () => {
	let getReplayList: GetReplayList;
	let mockRepo: jest.Mocked<ReplayRepository>;

	beforeEach(() => {
		mockRepo = {
			getReplayList: jest.fn().mockResolvedValue({
				replays: [
					{
						replayId: "r-1",
						endedAt: "2026-09-02 12:00:00",
						player1Name: "Alice",
						player2Name: "Bob",
						size: 512,
					},
				],
				total: 1,
			}),
			getReplayById: jest.fn(),
		};
		getReplayList = new GetReplayList(mockRepo);
	});

	it("returns replay list with total count and does not return replay bytea", async () => {
		const res = await getReplayList.run({
			format: "1103",
			page: 1,
			pageSize: 20,
		});

		expect(res.format).toBe("1103");
		expect(res.page).toBe(1);
		expect(res.pageSize).toBe(20);
		expect(res.total).toBe(1);
		expect(res.replays).toHaveLength(1);
		expect(res.replays[0]).not.toHaveProperty("replayData");
		expect(res.replays[0].replayId).toBe("r-1");
		expect(mockRepo.getReplayList).toHaveBeenCalledWith({
			formatId: "1103",
			page: 1,
			pageSize: 20,
			search: undefined,
		});
	});

	it("passes trimmed search keyword to repository", async () => {
		await getReplayList.run({
			format: "1109",
			page: 2,
			pageSize: 10,
			search: "  Alice  ",
		});

		expect(mockRepo.getReplayList).toHaveBeenCalledWith({
			formatId: "1109",
			page: 2,
			pageSize: 10,
			search: "Alice",
		});
	});

	it("rejects unsupported format", async () => {
		await expect(
			getReplayList.run({
				format: "9999",
			}),
		).rejects.toThrow("Invalid format");
	});

	it("normalizes invalid or negative page and pageSize", async () => {
		await getReplayList.run({
			format: "1103",
			page: -5,
			pageSize: 0,
		});

		expect(mockRepo.getReplayList).toHaveBeenCalledWith({
			formatId: "1103",
			page: 1,
			pageSize: 20,
			search: undefined,
		});
	});
});
