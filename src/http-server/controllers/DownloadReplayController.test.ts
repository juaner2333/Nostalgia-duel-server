import { DownloadReplayController } from "./DownloadReplayController";
import { DownloadReplay } from "@shared/stats/replays/application/DownloadReplay";
import { Request, Response } from "express";
import { config } from "src/config";

describe("DownloadReplayController", () => {
	let controller: DownloadReplayController;
	let downloadReplay: jest.Mocked<DownloadReplay>;
	let req: Partial<Request>;
	let res: Partial<Response>;
	const headers: Record<string, string> = {};
	const originalRanking = config.ranking.enabled;

	beforeEach(() => {
		config.ranking.enabled = true;
		downloadReplay = {
			run: jest.fn(),
		} as any;
		controller = new DownloadReplayController(downloadReplay);
		res = {
			status: jest.fn().mockReturnThis(),
			json: jest.fn().mockReturnThis(),
			send: jest.fn().mockReturnThis(),
			setHeader: jest.fn().mockImplementation((name: string, val: string) => {
				headers[name] = val;
				return res;
			}),
		};
	});

	afterEach(() => {
		config.ranking.enabled = originalRanking;
	});

	it("returns 503 when ranking is disabled", async () => {
		config.ranking.enabled = false;
		req = {
			params: { format: "1103", replayId: "rep-1" },
		};

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(503);
	});

	it("returns 200 with raw binary and Content-Disposition header when found", async () => {
		const fakeBinary = Buffer.from("YRP3\x00\x00\x00\x00fake-content");
		req = {
			params: { format: "1103", replayId: "rep-1" },
		};

		downloadReplay.run.mockResolvedValue({
			replayId: "rep-1",
			formatId: "1103",
			filename: "2026-09-02 23-45-10 Alice VS Bob.yrp",
			replayData: fakeBinary,
		});

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/octet-stream");
		expect(res.setHeader).toHaveBeenCalledWith(
			"Content-Disposition",
			expect.stringContaining("filename*=UTF-8''"),
		);
		expect(res.send).toHaveBeenCalledWith(fakeBinary);
	});

	it("returns 404 when replay not found", async () => {
		req = {
			params: { format: "1103", replayId: "not-found" },
		};

		downloadReplay.run.mockRejectedValue(new Error("Replay not found"));

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith({
			error: "Replay not found",
		});
	});
});
