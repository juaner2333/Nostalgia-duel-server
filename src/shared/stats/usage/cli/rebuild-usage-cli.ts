process.env.TZ = process.env.TZ || "Asia/Shanghai";

import { dataSource } from "../../../../evolution-types/src/data-source";
import { RebuildUsageStatisticsUseCase } from "../application/RebuildUsageStatisticsUseCase";
import { HalfYearWindow } from "../domain/HalfYearWindow";
import { CdbCardMetadataProvider } from "../infrastructure/cdb/CdbCardMetadataProvider";
import { UsageStatisticsPostgresRepository } from "../infrastructure/postgres/UsageStatisticsPostgresRepository";

export interface UsageCliArgs {
	period?: string;
	help?: boolean;
}

export function parseUsageCliArgs(args: string[]): UsageCliArgs {
	const result: UsageCliArgs = {};
	for (const arg of args) {
		if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg.startsWith("--period=")) {
			const val = arg.slice("--period=".length);
			if (!/^(\d{4})H([12])$/.test(val)) {
				throw new Error(`Invalid period format: ${val}. Must match YYYYH1 or YYYYH2.`);
			}
			result.period = val;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return result;
}

export async function runUsageCli(
	args: string[],
	deps?: { useCase: RebuildUsageStatisticsUseCase },
): Promise<number> {
	let parsed: UsageCliArgs;
	try {
		parsed = parseUsageCliArgs(args);
	} catch (err) {
		process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
		return 1;
	}

	if (parsed.help) {
		process.stdout.write(
			"Usage: node dist/src/shared/stats/usage/cli/rebuild-usage-cli.js [--period=YYYYH1|YYYYH2]\n",
		);
		return 0;
	}

	let useCase = deps?.useCase;
	let shouldDestroyDataSource = false;

	if (!useCase) {
		if (!dataSource.isInitialized) {
			await dataSource.initialize();
			shouldDestroyDataSource = true;
		}
		const repo = new UsageStatisticsPostgresRepository(dataSource);
		const cdb = new CdbCardMetadataProvider();
		useCase = new RebuildUsageStatisticsUseCase(repo, cdb);
	}

	try {
		process.stdout.write("========================================\n");
		process.stdout.write("Starting Usage Statistics Rebuild...\n");
		const report = parsed.period
			? await useCase.rebuildPeriod(parsed.period)
			: await useCase.rebuildDaily();

		for (const r of report.formatReports) {
			const periodStr = HalfYearWindow.periodFromWindowStart(r.windowStart);
			if (r.success) {
				const matchesInfo =
					r.admittedPhysicalMatches !== undefined
						? ` | AdmittedMatches: ${r.admittedPhysicalMatches}`
						: "";
				process.stdout.write(
					`[SUCCESS] Format: ${r.formatId} | Period: ${periodStr} | Cutoff: ${r.dataEndExclusive} | Decks: ${r.totalDecks} | SideKnown: ${r.sideKnownDecks}${matchesInfo} (${r.durationMs}ms)\n`,
				);
			} else {
				process.stderr.write(
					`[FAILED] Format: ${r.formatId} | Period: ${periodStr} | Error: ${r.error}\n`,
				);
			}
		}
		process.stdout.write("========================================\n");
		return report.success ? 0 : 1;
	} finally {
		if (shouldDestroyDataSource && dataSource.isInitialized) {
			await dataSource.destroy();
		}
	}
}

if (
	process.argv[1]?.endsWith("rebuild-usage-cli.ts") ||
	process.argv[1]?.endsWith("rebuild-usage-cli.js")
) {
	runUsageCli(process.argv.slice(2))
		.then((code) => {
			process.exit(code);
		})
		.catch((err) => {
			process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
			process.exit(1);
		});
}
