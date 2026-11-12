import { HistoricalRulingsDriver } from "@test-support/wasm/HistoricalRulingsDriver";
import { IdleCmdType, YGOProMsgNewTurn } from "ygopro-msg-encode";

const CANNON_SOLDIER = 11384280;
const TORRENTIAL_TRIBUTE = 53582587;
const TRIBUTE_FODDER = 70095154;

describe("GOAT ignition priority on the bundled WASM", () => {
	it.each([
		[1, [CANNON_SOLDIER, TORRENTIAL_TRIBUTE]],
		[2, [TORRENTIAL_TRIBUTE]],
	] as const)("offers the expected summon responses under rule %i", async (rule, expected) => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		try {
			duel.place(0, { hand: [CANNON_SOLDIER], mzone: [{ code: TRIBUTE_FODDER }] });
			duel.place(1, { szone: [{ code: TORRENTIAL_TRIBUTE }] });
			duel.idleAction = (msg) => {
				const cannon = msg.summonableCards.find((card) => card.code === CANNON_SOLDIER);
				return cannon
					? msg.prepareResponse(IdleCmdType.SUMMON, cannon)
					: msg.prepareResponse(IdleCmdType.TO_EP);
			};
			const activations: number[] = [];
			duel.selectChainIndex = (msg) => {
				const index = msg.chains.findIndex(
					(card) => card.code === CANNON_SOLDIER || card.code === TORRENTIAL_TRIBUTE,
				);
				if (index === -1) return null;
				activations.push(msg.chains[index]!.code);
				return index;
			};

			duel.start(rule);
			duel.runUntil((msg) => msg instanceof YGOProMsgNewTurn && msg.player === 1);
			expect(activations).toEqual(expected);
		} finally {
			duel.endDuel();
			driver.finalize();
		}
	});
});
