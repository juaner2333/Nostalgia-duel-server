const { pathsToModuleNameMapper } = require("ts-jest");
const { compilerOptions } = require("./tsconfig");

module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	modulePaths: [compilerOptions.baseUrl],
	moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths),
	roots: ["<rootDir>/src"],
	testPathIgnorePatterns: [
		"/src/evolution-types/src/.*Postgres\\.integration\\.test\\.ts$",
		"/src/shared/stats/usage/infrastructure/postgres/.*\\.integration\\.test\\.ts$",
		"/src/shared/stats/usage/UsagePipeline\\.integration\\.test\\.ts$",
	],
	maxWorkers: "50%",
	transform: {
		"^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
	},
};
