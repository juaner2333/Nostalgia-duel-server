// Tests for the persistence bootstrap. Postgres is conditional on ranking being
// enabled, Redis is always required.

jest.mock("src/config", () => ({
	config: { ranking: { enabled: true } },
}));
jest.mock("@shared/db/redis/infrastructure/Redis", () => ({
	Redis: jest.fn(),
}));
jest.mock("src/evolution-types/src/PostgresTypeORM", () => ({
	PostgresTypeORM: jest.fn(),
}));
jest.mock("src/evolution-types/src/data-source", () => ({
	dataSource: {
		showMigrations: jest.fn().mockResolvedValue(false),
	},
}));

import { Redis } from "@shared/db/redis/infrastructure/Redis";
import { Logger } from "@shared/logger/domain/Logger";
import { PostgresTypeORM } from "src/evolution-types/src/PostgresTypeORM";
import { dataSource } from "src/evolution-types/src/data-source";

import { config } from "src/config";

import { bootstrapPersistence } from "./bootstrapPersistence";

const MockRedis = Redis as unknown as jest.Mock;
const MockPostgres = PostgresTypeORM as unknown as jest.Mock;

function fakeLogger(): Logger {
	return {
		info: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
		debug: jest.fn(),
	} as unknown as Logger;
}

describe("bootstrapPersistence", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		config.ranking.enabled = true;
		(dataSource.showMigrations as jest.Mock).mockResolvedValue(false);
	});

	it("connects Postgres and Redis when ranking is enabled", async () => {
		const postgresConnect = jest.fn();
		const redisConnect = jest.fn();
		MockPostgres.mockImplementation(() => ({ connect: postgresConnect }));
		MockRedis.mockImplementation(() => ({ connect: redisConnect }));

		await bootstrapPersistence(fakeLogger());

		expect(postgresConnect).toHaveBeenCalledTimes(1);
		expect(redisConnect).toHaveBeenCalledTimes(1);
	});

	it("throws error and aborts when pending migrations exist", async () => {
		const postgresConnect = jest.fn();
		const postgresClose = jest.fn();
		MockPostgres.mockImplementation(() => ({
			connect: postgresConnect,
			close: postgresClose,
		}));
		(dataSource.showMigrations as jest.Mock).mockResolvedValue(true);

		await expect(bootstrapPersistence(fakeLogger())).rejects.toThrow(
			"Pending database migrations detected",
		);
		expect(postgresClose).toHaveBeenCalled();
	});

	it("skips Postgres but still connects Redis when ranking is disabled", async () => {
		config.ranking.enabled = false;
		const postgresConnect = jest.fn();
		const redisConnect = jest.fn();
		MockPostgres.mockImplementation(() => ({ connect: postgresConnect }));
		MockRedis.mockImplementation(() => ({ connect: redisConnect }));

		await bootstrapPersistence(fakeLogger());

		expect(postgresConnect).not.toHaveBeenCalled();
		expect(redisConnect).toHaveBeenCalledTimes(1);
	});
});
