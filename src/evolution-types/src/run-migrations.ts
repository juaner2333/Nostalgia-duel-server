import { DataSource } from "typeorm";
import { dataSource } from "./data-source";

export async function executeMigrations(
	ds: DataSource = dataSource,
): Promise<{ executedCount: number }> {
	await ds.initialize();
	try {
		const migrations = await ds.runMigrations();
		console.log(`Successfully executed ${migrations.length} migration(s).`);
		return { executedCount: migrations.length };
	} finally {
		if (ds.isInitialized) {
			await ds.destroy();
		}
	}
}

if (
	process.env.NODE_ENV !== "test" &&
	(process.argv[1]?.endsWith("run-migrations.ts") || process.argv[1]?.endsWith("run-migrations.js"))
) {
	executeMigrations()
		.then(() => process.exit(0))
		.catch((error) => {
			console.error("Migration execution failed:", error);
			process.exit(1);
		});
}
