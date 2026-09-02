import { Logger } from "src/shared/logger/domain/Logger";
import { UserProfileRepository } from "src/shared/user-profile/domain/UserProfileRepository";
import { DomainEventSubscriber } from "../../../event-bus/EventBus";
import { GameOverDomainEvent } from "../../../room/domain/match/domain/domain-events/GameOverDomainEvent";
import { RankedMatchPersistenceService } from "../../persistence/RankedMatchPersistenceService";

export class BasicStatsCalculator implements DomainEventSubscriber<GameOverDomainEvent> {
	static readonly ListenTo = GameOverDomainEvent.DOMAIN_EVENT;
	private readonly rankedMatchPersistenceService: RankedMatchPersistenceService;

	constructor(
		private readonly logger: Logger,
		private readonly userProfileRepository: UserProfileRepository,
		rankedMatchPersistenceService?: RankedMatchPersistenceService,
	) {
		this.logger = logger.child({ file: "BasicStatsCalculator" });
		this.rankedMatchPersistenceService =
			rankedMatchPersistenceService ??
			new RankedMatchPersistenceService(this.logger, this.userProfileRepository);
	}

	async handle(event: GameOverDomainEvent): Promise<void> {
		this.logger.info(
			`Duel finished for ${event.data.players.map((player) => player.name).join(" ")}`,
		);

		await this.rankedMatchPersistenceService.persist(event);
	}
}
