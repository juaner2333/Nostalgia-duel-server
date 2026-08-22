import { Redis } from "@shared/db/redis/infrastructure/Redis";
import { Logger } from "@shared/logger/domain/Logger";

import { config } from "src/config";
import { PostgresTypeORM } from "src/evolution-types/src/PostgresTypeORM";

// Opens every datastore connection the server depends on. Postgres is only
// touched when ranking is enabled; Redis is only connected when USE_REDIS=true.
export async function bootstrapPersistence(logger: Logger): Promise<void> {
	if (config.ranking.enabled) {
		const postgres = new PostgresTypeORM();
		await postgres.connect();
		logger.info("🗄️  Postgres connected · ranking ON");
	}

	const redis = new Redis();
	await redis.connect();
}
