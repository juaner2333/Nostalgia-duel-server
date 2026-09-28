import { parseUsageCliArgs, runUsageCli } from "./rebuild-usage-cli";
import { RebuildUsageStatisticsUseCase } from "../application/RebuildUsageStatisticsUseCase";

describe("rebuild-usage-cli", () => {
	it("parses --period argument correctly", () => {
		expect(parseUsageCliArgs(["--period=2026H1"])).toEqual({ period: "2026H1" });
		expect(parseUsageCliArgs(["--period=2026H2"])).toEqual({ period: "2026H2" });
		expect(parseUsageCliArgs([])).toEqual({});
		expect(parseUsageCliArgs(["--help"])).toEqual({ help: true });
	});

	it("throws on invalid period argument", () => {
		expect(() => parseUsageCliArgs(["--period=invalid"])).toThrow(/Invalid period/);
	});

	it("runs daily rebuild by default and exits 0 on success", async () => {
		const mockUseCase = {
			rebuildDaily: jest.fn().mockResolvedValue({
				success: true,
				formatReports: [
					{
						success: true,
						formatId: "1103",
						windowStart: "2026-07-01",
						dataEndExclusive: "2026-09-28",
						totalDecks: 2,
						sideKnownDecks: 1,
						durationMs: 10,
					},
					{
						success: true,
						formatId: "1109",
						windowStart: "2026-07-01",
						dataEndExclusive: "2026-09-28",
						totalDecks: 100,
						sideKnownDecks: 80,
						durationMs: 25,
					},
				],
			}),
			rebuildPeriod: jest.fn(),
		} as unknown as RebuildUsageStatisticsUseCase;

		const exitCode = await runUsageCli([], { useCase: mockUseCase });
		expect(exitCode).toBe(0);
		expect(mockUseCase.rebuildDaily).toHaveBeenCalled();
	});

	it("runs specific period rebuild when --period is specified", async () => {
		const mockUseCase = {
			rebuildDaily: jest.fn(),
			rebuildPeriod: jest.fn().mockResolvedValue({
				success: true,
				formatReports: [
					{
						success: true,
						formatId: "1103",
						windowStart: "2026-01-01",
						dataEndExclusive: "2026-07-01",
						totalDecks: 0,
						sideKnownDecks: 0,
						durationMs: 5,
					},
				],
			}),
		} as unknown as RebuildUsageStatisticsUseCase;

		const exitCode = await runUsageCli(["--period=2026H1"], { useCase: mockUseCase });
		expect(exitCode).toBe(0);
		expect(mockUseCase.rebuildPeriod).toHaveBeenCalledWith("2026H1");
	});

	it("returns exit code 1 if any rebuild fails", async () => {
		const mockUseCase = {
			rebuildDaily: jest.fn().mockResolvedValue({
				success: false,
				formatReports: [
					{
						success: false,
						formatId: "1109",
						windowStart: "2026-07-01",
						dataEndExclusive: "2026-09-28",
						error: "Database error",
					},
				],
			}),
			rebuildPeriod: jest.fn(),
		} as unknown as RebuildUsageStatisticsUseCase;

		const exitCode = await runUsageCli([], { useCase: mockUseCase });
		expect(exitCode).toBe(1);
	});
});
