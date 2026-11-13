import { HistoricalRulingsDriver } from "@test-support/wasm/HistoricalRulingsDriver";
import {
	IdleCmdType,
	OcgcoreScriptConstants as C,
	YGOProMsgMove,
	YGOProMsgNewPhase,
	YGOProMsgPosChange,
} from "ygopro-msg-encode";

const SNATCH_STEAL = 45986603;
const TSUKUYOMI = 34853266;
const BOOK_OF_MOON = 14087893;
const MYSTICAL_SPACE_TYPHOON = 5318639;
const OPPONENT_MONSTER = 41392891;

describe("GOAT Snatch Steal", () => {
	it.each([
		["Tsukuyomi", TSUKUYOMI, 0],
		["Book of Moon", BOOK_OF_MOON, 0],
		["Mystical Space Typhoon", MYSTICAL_SPACE_TYPHOON, 1],
	] as const)("settles control after %s removes the equip", async (_name, card, controller) => {
		const driver = await HistoricalRulingsDriver.create("1103", "goat");
		const duel = driver.createDuel();
		try {
			duel.place(0, { hand: [SNATCH_STEAL, card] });
			duel.place(1, { mzone: [{ code: OPPONENT_MONSTER }] });
			duel.idleAction = (msg) => {
				const snatch = msg.activatableCards.find((entry) => entry.code === SNATCH_STEAL);
				if (snatch) return msg.prepareResponse(IdleCmdType.ACTIVATE, snatch);
				const followUp = msg.activatableCards.find((entry) => entry.code === card);
				if (followUp) return msg.prepareResponse(IdleCmdType.ACTIVATE, followUp);
				const summon = msg.summonableCards.find((entry) => entry.code === card);
				if (summon) return msg.prepareResponse(IdleCmdType.SUMMON, summon);
				return msg.prepareResponse(IdleCmdType.TO_EP);
			};
			duel.selectCardIndex = (msg) => {
				return msg.cards.findIndex(
					(entry) => entry.code === OPPONENT_MONSTER || entry.code === SNATCH_STEAL,
				);
			};
			duel.start(1, "goat");
			const messages = duel.runUntil(
				(msg) => msg instanceof YGOProMsgNewPhase && msg.phase === C.PHASE_END,
			);
			expect(
				messages.some(
					(msg) =>
						msg instanceof YGOProMsgMove &&
						msg.code === OPPONENT_MONSTER &&
						msg.current.controller === 0,
				),
			).toBe(true);
			expect(
				messages.some(
					(msg) =>
						msg instanceof YGOProMsgMove &&
						msg.code === SNATCH_STEAL &&
						msg.current.location === C.LOCATION_GRAVE,
				),
			).toBe(true);
			expect(
				messages.some(
					(msg) =>
						msg instanceof YGOProMsgPosChange &&
						msg.code === OPPONENT_MONSTER &&
						msg.currentPosition === C.POS_FACEDOWN_DEFENSE,
				),
			).toBe(controller === 0);
			expect(duel.queryFieldCount(1, C.LOCATION_MZONE)).toBe(controller);
			expect(duel.queryFieldCount(0, C.LOCATION_MZONE)).toBe(
				1 - controller + Number(card === TSUKUYOMI),
			);
		} finally {
			duel.endDuel();
			driver.finalize();
		}
	});
});
