/**
 * Startup-flow test for stats subscriptions.
 *
 * The GAME_OVER subscribers (BasicStatsCalculator, UnrankedMatchSaver) are
 * registered by the explicit stats bootstrap (bootstrapStatsSubscriptions),
 * called once during startup after persistence is initialized and before the
 * duel servers accept traffic. This test locks that end state: the YGOPro-only
 * startup path — without constructing any EDOPro server — registers every
 * configured stats subscriber and delivers a YGOPro game-over event to each
 * exactly once (spec: 移除端点后统计订阅仍然有效).
 */

import "reflect-metadata";

jest.mock("@shared/stats/basic/application/BasicStatsCalculator", () => ({
	BasicStatsCalculator: jest.fn(),
}));
jest.mock("@shared/stats/unranked-match/application/UnrankedMatchSaver", () => ({
	UnrankedMatchSaver: jest.fn(),
}));

import { container } from "@shared/dependency-injection";
import { EventBus } from "@shared/event-bus/EventBus";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { PlayerMatchSummary } from "@shared/player/domain/Player";
import { Team } from "@shared/room/Team";
import { GameOverDomainEvent } from "@shared/room/domain/match/domain/domain-events/GameOverDomainEvent";
import { BasicStatsCalculator } from "@shared/stats/basic/application/BasicStatsCalculator";
import { UnrankedMatchSaver } from "@shared/stats/unranked-match/application/UnrankedMatchSaver";

import { bootstrapStatsSubscriptions } from "../../bootstrap/bootstrapStatsSubscriptions";

const basicHandle = jest.fn();
const unrankedHandle = jest.fn();

const player = (name: string, team: Team, winner: boolean): PlayerMatchSummary => ({
	id: null,
	team,
	name,
	winner,
	games: [{ result: winner ? "winner" : "loser", turns: 5, ipAddress: "127.0.0.1" }],
	score: 0,
});

describe("YGOPro-only startup · stats subscription", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(BasicStatsCalculator as unknown as jest.Mock).mockImplementation(() => ({
			handle: basicHandle,
		}));
		(UnrankedMatchSaver as unknown as jest.Mock).mockImplementation(() => ({
			handle: unrankedHandle,
		}));
		// The mocked classes must expose the same subscription key as the real ones.
		(BasicStatsCalculator as unknown as { ListenTo: string }).ListenTo =
			GameOverDomainEvent.DOMAIN_EVENT;
		(UnrankedMatchSaver as unknown as { ListenTo: string }).ListenTo =
			GameOverDomainEvent.DOMAIN_EVENT;
	});

	it("registers every configured stats subscriber and delivers a YGOPro game-over event exactly once without constructing any EDOPro server", () => {
		// YGOPro-only startup flow: the explicit stats bootstrap, and nothing
		// from the EDOPro side (no HostServer / WSHostServer).
		const logger = new LoggerMock();
		bootstrapStatsSubscriptions(logger);

		// A finished YGOPro duel publishes GAME_OVER on the container's EventBus
		// (same path as YGOProDuelingState.dispatchGameOverDomainEvent).
		const event = new GameOverDomainEvent({
			bestOf: 1,
			players: [player("Jaden", Team.PLAYER, true), player("Chazz", Team.OPPONENT, false)],
			date: new Date(),
			banListHash: 0,
			banListName: "N/A",
			ranked: false,
		});
		container.get(EventBus).publish(GameOverDomainEvent.DOMAIN_EVENT, event);

		// Registration happened without the EDOPro servers…
		expect(BasicStatsCalculator).toHaveBeenCalledTimes(1);
		expect(UnrankedMatchSaver).toHaveBeenCalledTimes(1);
		// …and each configured subscriber handled the event exactly once.
		expect(basicHandle).toHaveBeenCalledTimes(1);
		expect(basicHandle).toHaveBeenCalledWith(event);
		expect(unrankedHandle).toHaveBeenCalledTimes(1);
		expect(unrankedHandle).toHaveBeenCalledWith(event);
	});
});
