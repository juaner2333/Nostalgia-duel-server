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
			deckTypeCode: undefined,
		});
	});

	it("returns format-specific deckTypes options", async () => {
		const res1103 = await getReplayList.run({ format: "1103" });
		expect(res1103.deckTypes).toEqual([{ code: "OTHERS", nameZh: "其他" }]);

		const res1109 = await getReplayList.run({ format: "1109" });
		expect(res1109.deckTypes).toHaveLength(31);
		expect(res1109.deckTypes[0]).toEqual({ code: "D01", nameZh: "代行天使" });
		expect(res1109.deckTypes[29]).toEqual({ code: "D30", nameZh: "不死均" });
		expect(res1109.deckTypes[30]).toEqual({ code: "OTHERS", nameZh: "其他" });
	});

	it("passes valid deckTypeCode to repository", async () => {
		await getReplayList.run({
			format: "1109",
			deckTypeCode: "D01",
		});

		expect(mockRepo.getReplayList).toHaveBeenCalledWith(
			expect.objectContaining({
				formatId: "1109",
				deckTypeCode: "D01",
			}),
		);

		await getReplayList.run({
			format: "1103",
			deckTypeCode: "OTHERS",
		});

		expect(mockRepo.getReplayList).toHaveBeenCalledWith(
			expect.objectContaining({
				formatId: "1103",
				deckTypeCode: "OTHERS",
			}),
		);
	});

	it("treats empty or whitespace deckTypeCode as undefined", async () => {
		await getReplayList.run({
			format: "1109",
			deckTypeCode: "   ",
		});

		expect(mockRepo.getReplayList).toHaveBeenCalledWith(
			expect.objectContaining({
				deckTypeCode: undefined,
			}),
		);
	});

	it("rejects invalid deckTypeCode for the requested format", async () => {
		// 1109 type in 1103 format must be rejected
		await expect(
			getReplayList.run({
				format: "1103",
				deckTypeCode: "D01",
			}),
		).rejects.toThrow("Invalid deck type code");

		// Non-existent code in 1109 format must be rejected
		await expect(
			getReplayList.run({
				format: "1109",
				deckTypeCode: "INVALID_CODE",
			}),
		).rejects.toThrow("Invalid deck type code");
	});

	it("passes both search and deckTypeCode to repository", async () => {
		await getReplayList.run({
			format: "1109",
			search: "Alice",
			deckTypeCode: "D02",
		});

		expect(mockRepo.getReplayList).toHaveBeenCalledWith(
			expect.objectContaining({
				formatId: "1109",
				search: "Alice",
				deckTypeCode: "D02",
			}),
		);
	});
});
