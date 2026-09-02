/**
 * Startup-flow test for stats subscriptions.
 *
 * The GAME_OVER subscriber (BasicStatsCalculator) is
 * registered by the explicit stats bootstrap (bootstrapStatsSubscriptions),
 * called once during startup after persistence is initialized and before the
 * duel servers accept traffic. This test locks that end state: the YGOPro-only
 * startup path registers every configured stats subscriber and delivers a YGOPro
 * game-over event to each exactly once.
 */

import "reflect-metadata";

jest.mock("@shared/stats/basic/application/BasicStatsCalculator", () => ({
	BasicStatsCalculator: jest.fn(),
}));

import { container } from "@shared/dependency-injection";
import { EventBus } from "@shared/event-bus/EventBus";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { PlayerMatchSummary } from "@shared/player/domain/Player";
import { Team } from "@shared/room/Team";
import { GameOverDomainEvent } from "@shared/room/domain/match/domain/domain-events/GameOverDomainEvent";
import { BasicStatsCalculator } from "@shared/stats/basic/application/BasicStatsCalculator";
import { config } from "src/config";

import { bootstrapStatsSubscriptions } from "../../bootstrap/bootstrapStatsSubscriptions";

const basicHandle = jest.fn();

const player = (name: string, team: Team, winner: boolean): PlayerMatchSummary => ({
	id: null,
	team,
	name,
	winner,
	games: [{ result: winner ? "winner" : "loser", turns: 5, ipAddress: "127.0.0.1" }],
	score: 0,
});

describe("YGOPro-only startup · stats subscription", () => {
	const originalRankingEnabled = config.ranking.enabled;

	beforeEach(() => {
		config.ranking.enabled = true;
		jest.clearAllMocks();
		(BasicStatsCalculator as unknown as jest.Mock).mockImplementation(() => ({
			handle: basicHandle,
		}));
		(BasicStatsCalculator as unknown as { ListenTo: string }).ListenTo =
			GameOverDomainEvent.DOMAIN_EVENT;
	});

	it("registers configured stats subscriber and delivers a YGOPro game-over event exactly once", () => {
		const logger = new LoggerMock();
		bootstrapStatsSubscriptions(logger);

		const event = new GameOverDomainEvent({
			bestOf: 1,
			players: [player("Jaden", Team.PLAYER, true), player("Chazz", Team.OPPONENT, false)],
			date: new Date(),
			banListHash: 0,
			banListName: "N/A",
			ranked: false,
		});
		container.get(EventBus).publish(GameOverDomainEvent.DOMAIN_EVENT, event);

		expect(BasicStatsCalculator).toHaveBeenCalledTimes(1);
		expect(basicHandle).toHaveBeenCalledTimes(1);
		expect(basicHandle).toHaveBeenCalledWith(event);
	});

	it("skips registration when ranking is disabled (Postgres is not connected)", () => {
		config.ranking.enabled = false;

		const bus = container.get(EventBus) as unknown as {
			subscribers: Map<string, unknown[]>;
		};
		bus.subscribers.clear();

		const logger = new LoggerMock();
		bootstrapStatsSubscriptions(logger);

		expect(BasicStatsCalculator).not.toHaveBeenCalled();

		const event = new GameOverDomainEvent({
			bestOf: 1,
			players: [player("Jaden", Team.PLAYER, true), player("Chazz", Team.OPPONENT, false)],
			date: new Date(),
			banListHash: 0,
			banListName: "N/A",
			ranked: false,
		});
		container.get(EventBus).publish(GameOverDomainEvent.DOMAIN_EVENT, event);

		expect(basicHandle).not.toHaveBeenCalled();
	});

	afterEach(() => {
		config.ranking.enabled = originalRankingEnabled;
	});
});
