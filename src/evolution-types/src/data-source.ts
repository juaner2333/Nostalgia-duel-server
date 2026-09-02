import { join } from "path";
import { DataSource, DataSourceOptions } from "typeorm";

import { config } from "./config";
import { DuelReplayEntity } from "./entities/DuelReplayEntity";
import { DuelResumeEntity } from "./entities/DuelResumeEntity";
import { MatchResumeEntity } from "./entities/MatchResumeEntity";
import { PlayerStatsEntity } from "./entities/PlayerStatsEntity";
import { UserBanEntity } from "./entities/UserBanEntity";
import { UserProfileEntity } from "./entities/UserProfileEntity";

const options: DataSourceOptions = {
	type: "postgres",
	host: config.postgres.host,
	port: config.postgres.port,
	username: config.postgres.username,
	password: config.postgres.password,
	database: config.postgres.database,
	synchronize: false,
	logging: false,
	entities: [
		UserProfileEntity,
		UserBanEntity,
		MatchResumeEntity,
		DuelReplayEntity,
		DuelResumeEntity,
		PlayerStatsEntity,
	],
	subscribers: [],
	migrations: [
		join(__dirname, "/migrations/*.ts"),
		join(__dirname, "/migrations/*.js"),
	],
};
export const dataSource = new DataSource(options);
