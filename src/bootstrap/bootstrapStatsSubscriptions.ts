// Explicit stats-subscription startup.
//
// Registers the GAME_OVER subscribers (BasicStatsCalculator, UnrankedMatchSaver)
// on the container's EventBus. Must be called exactly once per process, after
// persistence is initialized and before the duel servers accept traffic. This
// used to be a side effect of constructing the EDOPro HostServer.

import { container } from "@shared/dependency-injection";
import { EventBus } from "@shared/event-bus/EventBus";
import { Logger } from "@shared/logger/domain/Logger";
import { BasicStatsCalculator } from "@shared/stats/basic/application/BasicStatsCalculator";
import { MatchResumeCreator } from "@shared/stats/match-resume/application/MatchResumeCreator";
import { DuelResumeCreator } from "@shared/stats/match-resume/duel-resume/application/DuelResumeCreator";
import { MatchResumePostgresRepository } from "@shared/stats/match-resume/infrastructure/postgres/MatchResumePostgresRepository";
import { PlayerStatsPostgresRepository } from "@shared/stats/player-stats/infrastructure/PlayerStatsPostgresRepository";
import { UnrankedMatchSaver } from "@shared/stats/unranked-match/application/UnrankedMatchSaver";
import { UnrankedMatchPostgresRepository } from "@shared/stats/unranked-match/infrastructure/postgres/UnrankedMatchPostgresRepository";
import { UserProfilePostgresRepository } from "@shared/user-profile/infrastructure/postgres/UserProfilePostgresRepository";

export function bootstrapStatsSubscriptions(logger: Logger): void {
	const eventBus = container.get(EventBus);

	eventBus.subscribe(
		BasicStatsCalculator.ListenTo,
		new BasicStatsCalculator(
			logger,
			new UserProfilePostgresRepository(),
			new PlayerStatsPostgresRepository(),
			new MatchResumeCreator(new MatchResumePostgresRepository()),
			new DuelResumeCreator(new MatchResumePostgresRepository()),
		),
	);

	eventBus.subscribe(
		UnrankedMatchSaver.ListenTo,
		new UnrankedMatchSaver(logger, new UnrankedMatchPostgresRepository()),
	);
}
