import { WindbotModule } from "../../../windbot/application/WindbotModule";
import { JoinStrategy } from "./JoinStrategy";
import { AIJoinTokenStrategy } from "./AIJoinTokenStrategy";
import { WindBotJoinStrategy } from "./WindBotJoinStrategy";
import { DefaultJoinStrategy } from "./DefaultJoinStrategy";
import { NostalgiaJoinStrategy } from "./NostalgiaJoinStrategy";

// Join-routing policy: this context owns the strategy priority order; the
// composition root only decides whether windbot is available.
export function composeJoinStrategies(windbot?: WindbotModule): JoinStrategy[] {
	const baseChain = [new NostalgiaJoinStrategy(), new DefaultJoinStrategy()];

	if (!windbot) {
		return baseChain;
	}

	return [new AIJoinTokenStrategy(windbot), new WindBotJoinStrategy(windbot), ...baseChain];
}
