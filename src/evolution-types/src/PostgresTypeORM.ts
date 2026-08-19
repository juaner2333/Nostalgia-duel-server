import { DataSource } from "typeorm";

import { dataSource } from "./data-source";
import { Database } from "./Database";

export class PostgresTypeORM implements Database {
	private readonly dataSource: DataSource;

	constructor() {
		this.dataSource = dataSource;
	}

	async connect(): Promise<void> {
		await this.dataSource.initialize();
	}

	async close(): Promise<void> {
		await this.dataSource.destroy();
	}
}
