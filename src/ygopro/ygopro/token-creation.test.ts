import { HistoricalRulingsDriver } from "@test-support/wasm/HistoricalRulingsDriver";
import {
	BattleCmdType,
	IdleCmdType,
	OcgcoreScriptConstants as C,
	YGOProMsgNewTurn,
	YGOProMsgSelectChain,
} from "ygopro-msg-encode";

const FODDER = 70095154; // サイバー・ドラゴン (ATK 2100)
const GORZ = 44330098; // 冥府の使者ゴーズ
const GORZ_TOKEN = 44330099; // 冥府の使者トークン

describe.each(["1103", "1109"] as const)("gorz emissary of darkness token (%s)", (formatId) => {
	it("creates the token with the battle damage stats after a direct attack", async () => {
		const driver = await HistoricalRulingsDriver.create(formatId);
		const duel = driver.createDuel();
		// Gorz special summons itself from the hand when the controller takes
		// battle damage from the opponent with no cards on the field.
		duel.place(0, { hand: [GORZ, FODDER, FODDER, FODDER, FODDER] });
		duel.place(1, { mzone: [{ code: FODDER }] });

		duel.battleAction = (msg) => {
			const attacker = msg.attackableCards.find((a) => a.code === FODDER);
			return attacker
				? msg.prepareResponse(BattleCmdType.ATTACK, attacker)
				: msg.prepareResponse(BattleCmdType.TO_EP);
		};
		duel.idleAction = (msg) => {
			return msg.canBp
				? msg.prepareResponse(IdleCmdType.TO_BP)
				: msg.prepareResponse(IdleCmdType.TO_EP);
		};
		duel.selectChainIndex = (msg: YGOProMsgSelectChain) => {
			const index = msg.chains.findIndex((chain) => chain.code === GORZ);
			return index >= 0 ? index : null;
		};

		duel.start();
		let newTurns = 0;
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 3;
		});

		const mzone = duel.queryFieldCards(0, C.LOCATION_MZONE);
		const token = mzone.cards.find((card) => card.code === GORZ_TOKEN);
		expect(token).toBeDefined();
		expect(token?.attack).toBe(2100);
		expect(token?.defense).toBe(2100);

		duel.endDuel();
		driver.finalize();
	});
});
