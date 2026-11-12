import { HistoricalRulingsDriver } from "@test-support/wasm/HistoricalRulingsDriver";
import {
	BattleCmdType,
	IdleCmdType,
	OcgcoreScriptConstants as C,
	YGOProMsgFlipSummoned,
	YGOProMsgNewPhase,
	YGOProMsgNewTurn,
	YGOProMsgPosChange,
} from "ygopro-msg-encode";

const SNATCH_STEAL = 45986603;
const ULTIMATE_OFFERING = 80604091;
const SHALLOW_GRAVE = 43434803;
const MIND_CONTROL = 37520316;
const OPPONENT_MONSTER = 41392891;
const OWN_MONSTER = 27125110;
const OJAMA_TRIO = 29843091;

describe("manual position changes after taking a newly summoned monster", () => {
	it.each([
		["goat", true],
		[undefined, false],
	] as const)("handles an opponent's Normal Summon with format %s", async (format, canChange) => {
		const driver = await HistoricalRulingsDriver.create("1103", "goat");
		const duel = driver.createDuel();
		try {
			duel.place(0, {
				hand: [OPPONENT_MONSTER],
				szone: [{ code: ULTIMATE_OFFERING, position: C.POS_FACEUP_ATTACK }],
			});
			duel.place(1, { hand: [SNATCH_STEAL] });
			let battleEntered = false;
			let summoned = false;
			let changed = false;
			duel.idleAction = (msg) => {
				if (duel.turnPlayer === 0) return msg.prepareResponse(IdleCmdType.TO_EP);
				if (!battleEntered && msg.canBp) {
					battleEntered = true;
					return msg.prepareResponse(IdleCmdType.TO_BP);
				}
				const snatch = msg.activatableCards.find((card) => card.code === SNATCH_STEAL);
				if (snatch) return msg.prepareResponse(IdleCmdType.ACTIVATE, snatch);
				const monster = msg.reposableCards.find((card) => card.code === OPPONENT_MONSTER);
				if (monster && !changed) {
					changed = true;
					return msg.prepareResponse(IdleCmdType.REPOS, monster);
				}
				expect(monster).toBeUndefined();
				return msg.prepareResponse(IdleCmdType.TO_EP);
			};
			duel.selectChainIndex = (msg) => {
				const index = msg.chains.findIndex((card) => card.code === ULTIMATE_OFFERING);
				if (index < 0 || summoned) return null;
				summoned = true;
				return index;
			};
			duel.battleAction = (msg) => msg.prepareResponse(BattleCmdType.TO_M2);
			duel.start(1, format);
			const messages = duel.runUntil((msg) => msg instanceof YGOProMsgNewTurn && duel.turn >= 4);
			expect(summoned).toBe(true);
			expect(duel.queryFieldCount(0, C.LOCATION_MZONE)).toBe(0);
			expect(duel.queryFieldCount(1, C.LOCATION_MZONE)).toBe(1);
			expect(changed).toBe(canChange);
			expect(
				messages.some(
					(msg) =>
						msg instanceof YGOProMsgPosChange &&
						msg.code === OPPONENT_MONSTER &&
						msg.card.controller === 1 &&
						msg.currentPosition === C.POS_FACEUP_DEFENSE,
				),
			).toBe(canChange);
		} finally {
			duel.endDuel();
			driver.finalize();
		}
	});

	it.each([
		["goat", true],
		[undefined, false],
	] as const)("handles face-down Special Summons with format %s", async (format, canFlip) => {
		const driver = await HistoricalRulingsDriver.create("1103", "goat");
		const duel = driver.createDuel();
		try {
			duel.place(0, { hand: [SHALLOW_GRAVE, MIND_CONTROL], grave: [OWN_MONSTER] });
			duel.place(1, { grave: [OPPONENT_MONSTER] });
			let flipped = false;
			duel.idleAction = (msg) => {
				const spell = msg.activatableCards.find(
					(card) => card.code === SHALLOW_GRAVE || card.code === MIND_CONTROL,
				);
				if (spell) return msg.prepareResponse(IdleCmdType.ACTIVATE, spell);
				expect(msg.reposableCards.some((card) => card.code === OWN_MONSTER)).toBe(false);
				const monster = msg.reposableCards.find((card) => card.code === OPPONENT_MONSTER);
				if (monster && !flipped) {
					flipped = true;
					return msg.prepareResponse(IdleCmdType.REPOS, monster);
				}
				expect(monster).toBeUndefined();
				return msg.prepareResponse(IdleCmdType.TO_EP);
			};
			duel.start(1, format);
			const messages = duel.runUntil(
				(msg) => msg instanceof YGOProMsgNewPhase && msg.phase === C.PHASE_END,
			);
			expect(duel.queryFieldCount(0, C.LOCATION_MZONE)).toBe(2);
			expect(duel.queryFieldCount(1, C.LOCATION_MZONE)).toBe(0);
			expect(flipped).toBe(canFlip);
			expect(messages.some((msg) => msg instanceof YGOProMsgFlipSummoned)).toBe(canFlip);
		} finally {
			duel.endDuel();
			driver.finalize();
		}
	});

	it("keeps the summon lock for monsters placed directly on the turn player's field", async () => {
		const driver = await HistoricalRulingsDriver.create("1103", "goat");
		const duel = driver.createDuel();
		try {
			duel.place(0, {});
			duel.place(1, { szone: [{ code: OJAMA_TRIO }] });
			let activated = false;
			duel.selectChainIndex = (msg) => {
				const index = msg.chains.findIndex((card) => card.code === OJAMA_TRIO);
				if (index < 0 || activated) return null;
				activated = true;
				return index;
			};
			duel.idleAction = (msg) => {
				expect(msg.reposableCards).toHaveLength(0);
				return msg.prepareResponse(IdleCmdType.TO_EP);
			};
			duel.start(1, "goat");
			duel.runUntil((msg) => msg instanceof YGOProMsgNewTurn && msg.player === 1);
			expect(activated).toBe(true);
			expect(duel.queryFieldCount(0, C.LOCATION_MZONE)).toBe(3);
		} finally {
			duel.endDuel();
			driver.finalize();
		}
	});
});
