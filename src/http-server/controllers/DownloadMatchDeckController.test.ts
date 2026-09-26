import { DownloadMatchDeckController } from "./DownloadMatchDeckController";
import { DownloadMatchDeck } from "@shared/deck/application/DownloadMatchDeck";
import { Request, Response } from "express";
import { config } from "src/config";

describe("DownloadMatchDeckController", () => {
	let controller: DownloadMatchDeckController;
	let downloadMatchDeck: jest.Mocked<DownloadMatchDeck>;
	let req: Partial<Request>;
	let res: Partial<Response>;
	const originalRanking = config.ranking.enabled;

	beforeEach(() => {
		config.ranking.enabled = true;
		downloadMatchDeck = {
			run: jest.fn(),
		} as any;
		controller = new DownloadMatchDeckController(downloadMatchDeck);
		res = {
			status: jest.fn().mockReturnThis(),
			json: jest.fn().mockReturnThis(),
			send: jest.fn().mockReturnThis(),
			setHeader: jest.fn().mockReturnThis(),
		};
	});

	afterEach(() => {
		config.ranking.enabled = originalRanking;
	});

	it("returns 503 when ranking is disabled", async () => {
		config.ranking.enabled = false;
		req = {
			params: { format: "1109", matchId: "m-101" },
		};

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(503);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining("ranking disabled"),
			}),
		);
	});

	it("returns 200 with text/plain, X-Deck-Completeness, and Content-Disposition headers for complete deck", async () => {
		req = {
			params: { format: "1109", matchId: "m-101" },
		};

		downloadMatchDeck.run.mockResolvedValueOnce({
			matchId: "m-101",
			formatId: "1109",
			filename: "2026-09-02 20-00-00 Alice VS Bob (complete).ydk",
			safeAsciiFilename: "match-m-101-complete.ydk",
			completeness: "complete",
			ydkContent: "#main\r\n46986414\r\n#extra\r\n!side\r\n",
		});

		await controller.run(req as Request, res as Response);

		expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/plain; charset=utf-8");
		expect(res.setHeader).toHaveBeenCalledWith("X-Deck-Completeness", "complete");
		expect(res.setHeader).toHaveBeenCalledWith(
			"Content-Disposition",
			expect.stringContaining('attachment; filename="match-m-101-complete.ydk"'),
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.send).toHaveBeenCalledWith("#main\r\n46986414\r\n#extra\r\n!side\r\n");
	});

	it("returns 200 with X-Deck-Completeness: partial for partial deck", async () => {
		req = {
			params: { format: "1103", matchId: "m-102" },
		};

		downloadMatchDeck.run.mockResolvedValueOnce({
			matchId: "m-102",
			formatId: "1103",
			filename: "2026-09-02 20-00-00 Charlie VS Dave (partial).ydk",
			safeAsciiFilename: "match-m-102-partial.ydk",
			completeness: "partial",
			ydkContent: "#main\r\n46986414\r\n#extra\r\n!side\r\n",
		});

		await controller.run(req as Request, res as Response);

		expect(res.setHeader).toHaveBeenCalledWith("X-Deck-Completeness", "partial");
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it("returns 404 when match deck snapshot is not found", async () => {
		req = {
			params: { format: "1109", matchId: "unknown-match" },
		};

		downloadMatchDeck.run.mockRejectedValueOnce(new Error("Match deck snapshot not found"));

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith({
			error: "Match deck snapshot not found",
		});
	});

	it("returns 400 when format is invalid", async () => {
		req = {
			params: { format: "invalid-format", matchId: "m-101" },
		};

		downloadMatchDeck.run.mockRejectedValueOnce(new Error("Invalid format: invalid-format"));

		await controller.run(req as Request, res as Response);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			error: "Invalid format: invalid-format",
		});
	});
});
