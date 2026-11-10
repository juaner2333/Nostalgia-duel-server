import type { NostalgiaResourceProfile } from "../ygopro/room/domain/NostalgiaFormat";
import { parseWindbotConfig } from "../ygopro/windbot/infrastructure/WindbotConfig";

const resourceProfile = process.env.NOSTALGIA_PROFILE ?? "goat";
if (resourceProfile !== "2011" && resourceProfile !== "goat") {
	throw new Error(`Unsupported NOSTALGIA_PROFILE: ${resourceProfile}`);
}

const resources: { dir: string; profile: NostalgiaResourceProfile } = {
	dir: process.env.RESOURCES_DIR ?? "./nostalgia-resources",
	profile: resourceProfile,
};

export const config = {
	redis: {
		use: process.env.USE_REDIS === "true",
		uri: process.env.REDIS_URI,
	},
	env: process.env.NODE_ENV,
	adminApiKey: process.env.ADMIN_API_KEY,
	postgres: {
		username: process.env.POSTGRES_USER,
		password: process.env.POSTGRES_PASSWORD,
		database: process.env.POSTGRES_DB,
		host: process.env.POSTGRES_HOST ?? "localhost",
		port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
	},
	ranking: {
		enabled: resourceProfile === "2011" && process.env.RANK_ENABLED === "true",
	},
	season: Number(process.env.SEASON),
	allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") ?? ["*"],
	rateLimit: {
		enabled: process.env.RATE_LIMIT_ENABLED === "true",
		limit: Number(process.env.RATE_LIMIT),
		window: Number(process.env.RATE_LIMIT_WINDOW),
	},
	servers: {
		mercury: {
			port: Number(process.env.YGOPRO_PORT),
			wsPort: Number(process.env.YGOPRO_WEBSOCKET_PORT) || 4002,
			wsHeartbeatIntervalMs: Number(process.env.YGOPRO_WEBSOCKET_HEARTBEAT_MS) || 30000,
		},
		http: {
			port: Number(process.env.HTTP_PORT),
		},
		websocket: {
			port: Number(process.env.WEBSOCKET_PORT),
		},
	},
	resources,
	sideTimeoutMinutes: Number(process.env.SIDE_TIMEOUT_MINUTES) || 3,
	windbot: parseWindbotConfig(resourceProfile === "goat" ? {} : process.env),
};
