import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Pool } from "pg";
import {
	ReplayDeckBackfillService,
	validateDatabaseConfigs,
	PostgresConnectionConfig,
	BackfillReport,
} from "../src/shared/deck/application/backfill/ReplayDeckBackfillService";

function parseArgs(args: string[]) {
	let envFile: string | undefined = undefined;
	let format: string = "all";
	let execute = false;
	let limit: number | undefined = undefined;
	let batchSize: number = 100;

	for (const arg of args) {
		if (arg.startsWith("--env-file=")) {
			envFile = arg.slice("--env-file=".length);
		} else if (arg.startsWith("--format=")) {
			format = arg.slice("--format=".length);
		} else if (arg === "--execute") {
			execute = true;
		} else if (arg === "--dry-run") {
			execute = false;
		} else if (arg.startsWith("--limit=")) {
			limit = parseInt(arg.slice("--limit=".length), 10);
		} else if (arg.startsWith("--batch-size=")) {
			batchSize = parseInt(arg.slice("--batch-size=".length), 10);
		}
	}

	return { envFile, format, execute, limit, batchSize };
}

function loadEnvFile(envFilePath?: string) {
	if (envFilePath) {
		const fullPath = path.resolve(process.cwd(), envFilePath);
		if (!fs.existsSync(fullPath)) {
			process.stderr.write(`Error: Specified env file not found: ${envFilePath}\n`);
			process.exit(1);
		}
		dotenv.config({ path: fullPath, override: true });
	} else {
		dotenv.config();
	}
}

function printReport(report: BackfillReport) {
	process.stdout.write("========================================\n");
	process.stdout.write(`环境 Format: ${report.formatId}\n`);
	process.stdout.write(
		`运行模式: ${report.dryRun ? "只读预演 (DRY-RUN)" : "正式执行 (EXECUTE)"}\n`,
	);
	process.stdout.write(`扫描场次: ${report.scannedGames}\n`);
	process.stdout.write(`有效候选: ${report.candidates}\n`);
	process.stdout.write(`成功写入/模拟: ${report.successful}\n`);
	process.stdout.write("跳过统计:\n");
	process.stdout.write(`  - 已存在完整在线快照: ${report.skipped.onlineSnapshotExists}\n`);
	process.stdout.write(`  - 双方已完成回填: ${report.skipped.alreadyBackfilled}\n`);
	process.stdout.write(`  - 视角异常或单方缺失: ${report.skipped.invalidPerspectives}\n`);
	process.stdout.write(`  - 缺少 G1 录像: ${report.skipped.missingG1Replay}\n`);
	process.stdout.write(`  - 录像损坏或卡组非法: ${report.skipped.invalidReplayOrDeck}\n`);
	process.stdout.write(`  - 玩家身份存在歧义: ${report.skipped.ambiguousIdentity}\n`);
	process.stdout.write("========================================\n\n");
}

export async function runBackfillCli(args = process.argv.slice(2)) {
	const options = parseArgs(args);
	loadEnvFile(options.envFile);

	const readonlyConfig: PostgresConnectionConfig = {
		host: process.env.READONLY_PG_HOST || process.env.POSTGRES_HOST || "localhost",
		port: Number(process.env.READONLY_PG_PORT || process.env.POSTGRES_PORT || 5432),
		database: process.env.READONLY_PG_DATABASE || process.env.POSTGRES_DB || "nostalgia",
		user: process.env.READONLY_PG_USER || process.env.POSTGRES_USER || "postgres",
		password: process.env.READONLY_PG_PASSWORD || process.env.POSTGRES_PASSWORD || "",
	};

	const writeConfig: PostgresConnectionConfig = {
		host: process.env.POSTGRES_HOST || "localhost",
		port: Number(process.env.POSTGRES_PORT || 5432),
		database: process.env.POSTGRES_DB || "nostalgia",
		user: process.env.POSTGRES_USER || "postgres",
		password: process.env.POSTGRES_PASSWORD || "",
	};

	const precheck = validateDatabaseConfigs(readonlyConfig, writeConfig);
	if (!precheck.valid) {
		process.stderr.write(`Precheck failed: ${precheck.error}\n`);
		process.exit(1);
	}

	const readonlyPool = new Pool({
		host: readonlyConfig.host,
		port: readonlyConfig.port,
		database: readonlyConfig.database,
		user: readonlyConfig.user,
		password: readonlyConfig.password,
		max: 5,
	});

	const writePool = new Pool({
		host: writeConfig.host,
		port: writeConfig.port,
		database: writeConfig.database,
		user: writeConfig.user,
		password: writeConfig.password,
		max: 5,
	});

	try {
		const service = new ReplayDeckBackfillService(readonlyPool, writePool);
		const formats = options.format === "all" ? ["1103", "1109"] : [options.format];

		for (const formatId of formats) {
			if (formatId !== "1103" && formatId !== "1109") {
				process.stderr.write(`Error: Unsupported format: ${formatId}\n`);
				process.exit(1);
			}

			const report = await service.run({
				formatId,
				dryRun: !options.execute,
				batchSize: options.batchSize,
				limit: options.limit,
			});

			printReport(report);
		}
	} finally {
		await readonlyPool.end();
		await writePool.end();
	}
}

if (require.main === module) {
	runBackfillCli().catch((err) => {
		process.stderr.write(`Execution failed: ${err.message || String(err)}\n`);
		process.exit(1);
	});
}
