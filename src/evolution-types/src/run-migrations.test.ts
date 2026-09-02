import { executeMigrations } from "./run-migrations";
import { DataSource } from "typeorm";

describe("Production Migration Runner", () => {
	let mockDataSource: jest.Mocked<DataSource>;

	beforeEach(() => {
		mockDataSource = {
			initialize: jest.fn().mockResolvedValue(undefined),
			runMigrations: jest.fn().mockResolvedValue([{ name: "InitialRankedSchema1741000000000" }]),
			destroy: jest.fn().mockResolvedValue(undefined),
			isInitialized: true,
		} as unknown as jest.Mocked<DataSource>;
	});

	it("initializes datasource, executes pending migrations, and destroys datasource", async () => {
		const result = await executeMigrations(mockDataSource);

		expect(mockDataSource.initialize).toHaveBeenCalledTimes(1);
		expect(mockDataSource.runMigrations).toHaveBeenCalledTimes(1);
		expect(mockDataSource.destroy).toHaveBeenCalledTimes(1);
		expect(result.executedCount).toBe(1);
	});

	it("ensures datasource is destroyed even when runMigrations throws", async () => {
		mockDataSource.runMigrations.mockRejectedValue(new Error("SQL syntax error"));

		await expect(executeMigrations(mockDataSource)).rejects.toThrow("SQL syntax error");

		expect(mockDataSource.initialize).toHaveBeenCalledTimes(1);
		expect(mockDataSource.destroy).toHaveBeenCalledTimes(1);
	});
});
