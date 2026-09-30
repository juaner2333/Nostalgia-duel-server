import { join } from "path";
import { DataSource, DataSourceOptions } from "typeorm";

import { config } from "./config";
import { DeckTypeEntity } from "./entities/DeckTypeEntity";
import { DuelReplayEntity } from "./entities/DuelReplayEntity";
import { DuelResumeEntity } from "./entities/DuelResumeEntity";
import { MatchDeckEntity } from "./entities/MatchDeckEntity";
import { MatchResumeEntity } from "./entities/MatchResumeEntity";
import { PlayerStatsEntity } from "./entities/PlayerStatsEntity";
import { UsageCardRowEntity } from "./entities/UsageCardRowEntity";
import { UsageDeckRowEntity } from "./entities/UsageDeckRowEntity";
import { UsageStatRunEntity } from "./entities/UsageStatRunEntity";
import { StatsDeckMatchupEntity } from "./entities/StatsDeckMatchupEntity";
import { UserBanEntity } from "./entities/UserBanEntity";
import { UserProfileEntity } from "./entities/UserProfileEntity";
import { StatsDeckDetailMatchupEntity } from "./entities/StatsDeckDetailMatchupEntity";
import { StatsDeckTopPlayerEntity } from "./entities/StatsDeckTopPlayerEntity";

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
		DeckTypeEntity,
		MatchDeckEntity,
		UsageStatRunEntity,
		UsageDeckRowEntity,
		UsageCardRowEntity,
		StatsDeckMatchupEntity,
		StatsDeckDetailMatchupEntity,
		StatsDeckTopPlayerEntity,
	],
	subscribers: [],
	migrations: [
		join(__dirname, "/migrations/*.ts"),
		join(__dirname, "/migrations/*.js"),
	],
};
export const dataSource = new DataSource(options);
