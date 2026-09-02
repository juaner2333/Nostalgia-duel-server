import { composeJoinStrategies } from "./composeJoinStrategies";
import { AIJoinTokenStrategy } from "./AIJoinTokenStrategy";
import { WindBotJoinStrategy } from "./WindBotJoinStrategy";
import { DefaultJoinStrategy } from "./DefaultJoinStrategy";
import { NostalgiaJoinStrategy } from "./NostalgiaJoinStrategy";
import { NostalgiaRankedJoinStrategy } from "./NostalgiaRankedJoinStrategy";
import { WindbotModule } from "../../../windbot/application/WindbotModule";
import { WindbotTokenStore } from "../../../windbot/domain/WindbotTokenStore";

const makeModule = (): WindbotModule =>
	WindbotModule.createForTests({
		enabled: true,
		repo: {
			findAll: jest.fn(),
			findByName: jest.fn(),
			pickRandom: jest.fn(),
		} as never,
		tokenStore: WindbotTokenStore.createForTests(),
		provider: { requestJoin: jest.fn() } as never,
	});

describe("composeJoinStrategies", () => {
	it("returns the base chain [Ranked, Nostalgia, Default] when windbot is absent", () => {
		const strategies = composeJoinStrategies();

		expect(strategies).toHaveLength(3);
		expect(strategies[0]).toBeInstanceOf(NostalgiaRankedJoinStrategy);
		expect(strategies[1]).toBeInstanceOf(NostalgiaJoinStrategy);
		expect(strategies[2]).toBeInstanceOf(DefaultJoinStrategy);
	});

	it("prepends [AIJoinToken, WindBot] before the base chain when windbot is present", () => {
		const strategies = composeJoinStrategies(makeModule());

		expect(strategies).toHaveLength(5);
		expect(strategies[0]).toBeInstanceOf(AIJoinTokenStrategy);
		expect(strategies[1]).toBeInstanceOf(WindBotJoinStrategy);
		expect(strategies[2]).toBeInstanceOf(NostalgiaRankedJoinStrategy);
		expect(strategies[3]).toBeInstanceOf(NostalgiaJoinStrategy);
		expect(strategies[4]).toBeInstanceOf(DefaultJoinStrategy);
	});
});
