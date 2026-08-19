import * as dotenv from "dotenv";

dotenv.config();

export const config = {
	postgres: {
		username: process.env.POSTGRES_USER,
		password: process.env.POSTGRES_PASSWORD,
		database: process.env.POSTGRES_DB,
		host: process.env.POSTGRES_HOST ?? "localhost",
		port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
	},
};
