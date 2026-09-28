const config = require("./jest.config");

module.exports = {
	...config,
	testPathIgnorePatterns: [],
	testMatch: [
		"<rootDir>/src/evolution-types/src/*Postgres.integration.test.ts",
		"<rootDir>/src/shared/stats/usage/infrastructure/postgres/*.integration.test.ts",
		"<rootDir>/src/shared/stats/usage/UsagePipeline.integration.test.ts",
	],
};
