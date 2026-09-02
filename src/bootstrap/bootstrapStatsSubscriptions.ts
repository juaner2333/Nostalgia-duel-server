// Explicit stats-subscription startup.
//
// Registers the GAME_OVER subscribers (BasicStatsCalculator, UnrankedMatchSaver)
// on the container's EventBus. Must be called exactly once per process, after
// persistence is initialized and before the duel servers accept traffic. This
// used to be a side effect of constructing the EDOPro HostServer.

import { config } from "src/config";
import { container } from "@shared/dependency-injection";
import { EventBus } from "@shared/event-bus/EventBus";
import { Logger } from "@shared/logger/domain/Logger";
import { BasicStatsCalculator } from "@shared/stats/basic/application/BasicStatsCalculator";
import { UserProfilePostgresRepository } from "@shared/user-profile/infrastructure/postgres/UserProfilePostgresRepository";

export function bootstrapStatsSubscriptions(logger: Logger): void {
	if (!config.ranking.enabled) {
		logger.info("Stats subscriptions skipped — ranking disabled (Postgres not connected)");
		return;
	}

	const eventBus = container.get(EventBus);

	eventBus.subscribe(
		BasicStatsCalculator.ListenTo,
		new BasicStatsCalculator(logger, new UserProfilePostgresRepository()),
	);
}
