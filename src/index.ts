import "reflect-metadata";
import "src/shared/error-handler/error-handler";

import LoggerFactory from "src/shared/logger/infrastructure/LoggerFactory";

import { config } from "./config";
import { bootstrapYgoproResources } from "./bootstrap/bootstrapYgoproResources";
import { bootstrapPersistence } from "./bootstrap/bootstrapPersistence";
import { bootstrapStatsSubscriptions } from "./bootstrap/bootstrapStatsSubscriptions";
import { bootstrapMatchmaking } from "./bootstrap/bootstrapMatchmaking";
import { Server } from "./http-server/Server";
import { YGOProServer } from "./socket-server/YGOProServer";
import { WSYGOProServer } from "./socket-server/WSYGOProServer";
import { HandshakeTicketAuthenticator } from "./socket-server/HandshakeTicketAuthenticator";
import { RedisTicketRepository } from "./shared/ticket/infrastructure/redis/RedisTicketRepository";
import WebSocketSingleton from "./web-socket-server/WebSocketSingleton";
import { bootstrapWindbot } from "./ygopro/windbot/infrastructure/bootstrapWindbot";
import { JoinStrategyRegistry } from "./ygopro/room/application/join-strategies/JoinStrategyRegistry";
import { composeJoinStrategies } from "./ygopro/room/application/join-strategies/composeJoinStrategies";

void start();

async function start(): Promise<void> {
	const logger = LoggerFactory.getLogger();

	logger.info("🚀 Evolution server starting…");

	const ticketRepository = new RedisTicketRepository();
	const server = new Server(logger, ticketRepository);
	const ygoproServer = new YGOProServer(logger);
	const wsYgoproServer = new WSYGOProServer(
		logger,
		new HandshakeTicketAuthenticator(ticketRepository),
	);

	await bootstrapYgoproResources(logger);
	await bootstrapPersistence(logger);
	// After persistence so Postgres repositories are ready, before any server
	// accepts traffic so no game-over event can be missed.
	bootstrapStatsSubscriptions(logger);

	await server.initialize();
	WebSocketSingleton.getInstance();

	// config.windbot is validated for fail-fast at module load (src/config/index.ts).
	const windbotModule = config.windbot.enabled
		? bootstrapWindbot(config.windbot, config.servers.mercury.port)
		: undefined;
	JoinStrategyRegistry.setStrategies(composeJoinStrategies(windbotModule));
	if (windbotModule) {
		logger.info("🤖 Windbot enabled");
	}

	// After windbot so the queue's bot-fallback availability check reflects it.
	bootstrapMatchmaking(logger);

	ygoproServer.initialize();
	wsYgoproServer.initialize();

	logger.info(`🔌 HTTP      → :${config.servers.http.port}`);
	logger.info(
		`🔌 Mercury   → TCP :${config.servers.mercury.port} · WS :${config.servers.mercury.wsPort}`,
	);
	logger.info("✅ Evolution server ready");
}
