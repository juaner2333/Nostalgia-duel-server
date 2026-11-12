import {
	HistoricalRulingsDriver,
	type HistoricalTestDuel,
} from "@test-support/wasm/HistoricalRulingsDriver";
import {
	BattleCmdType,
	IdleCmdType,
	OcgcoreScriptConstants as C,
	YGOProMsgDamage,
	YGOProMsgDamageStepStart,
	YGOProMsgNewTurn,
	YGOProMsgPayLpCost,
} from "ygopro-msg-encode";

const GOAT = "goat";
const DARK_ELF = 21417692;
const BLUE_EYES = 89631139;
const REVIVED_MONSTER = 41392891;
const CALL_OF_THE_HAUNTED = 97077563;
const MAGIC_CYLINDER = 62279055;
const SAKURETSU_ARMOR = 56120475;
const THOUSAND_EYES_IDOL = 27125110;

async function withDuel(run: (duel: HistoricalTestDuel) => void) {
	const driver = await HistoricalRulingsDriver.create("1103", GOAT);
	const duel = driver.createDuel();
	try {
		duel.idleAction = (msg) =>
			msg.prepareResponse(
				duel.turnPlayer === 1 && msg.canBp ? IdleCmdType.TO_BP : IdleCmdType.TO_EP,
			);
		run(duel);
	} finally {
		duel.endDuel();
		driver.finalize();
	}
}

function finishBattle(duel: HistoricalTestDuel, format: "goat" | undefined) {
	duel.start(1, format);
	return duel.runUntil((msg) => msg instanceof YGOProMsgNewTurn && duel.turn >= 4);
}

describe("GOAT battle rulings on the bundled WASM", () => {
	it.each([
		[GOAT, C.POS_FACEUP_ATTACK, 0],
		[GOAT, C.POS_FACEUP_DEFENSE, 1],
		[undefined, C.POS_FACEUP_ATTACK, 1],
	] as const)("resolves equal zero values with format %s and defender position %i", async (format, position, remaining) => {
		await withDuel((duel) => {
			duel.place(1, { mzone: [{ code: THOUSAND_EYES_IDOL }] });
			duel.place(0, { mzone: [{ code: THOUSAND_EYES_IDOL, position }] });
			duel.battleAction = (msg) => {
				const attacker = msg.attackableCards[0];
				return attacker
					? msg.prepareResponse(BattleCmdType.ATTACK, attacker)
					: msg.prepareResponse(BattleCmdType.TO_EP);
			};
			const messages = finishBattle(duel, format);
			expect(duel.queryFieldCount(0, C.LOCATION_MZONE)).toBe(remaining);
			expect(duel.queryFieldCount(1, C.LOCATION_MZONE)).toBe(remaining);
			expect(duel.queryFieldCount(0, C.LOCATION_GRAVE)).toBe(1 - remaining);
			expect(duel.queryFieldCount(1, C.LOCATION_GRAVE)).toBe(1 - remaining);
			expect(messages.some((msg) => msg instanceof YGOProMsgDamageStepStart)).toBe(true);
			expect(messages.some((msg) => msg instanceof YGOProMsgDamage)).toBe(false);
		});
	});

	it.each([
		[GOAT, CALL_OF_THE_HAUNTED, [DARK_ELF, BLUE_EYES, DARK_ELF], 2],
		[undefined, CALL_OF_THE_HAUNTED, [DARK_ELF, BLUE_EYES], 1],
		[GOAT, MAGIC_CYLINDER, [DARK_ELF, BLUE_EYES], 1],
	] as const)("offers the correct attackers for format %s and trap %i", async (format, trap, attackOrder, payments) => {
		await withDuel((duel) => {
			duel.place(1, { mzone: [{ code: DARK_ELF }, { code: BLUE_EYES }] });
			duel.place(0, { grave: [REVIVED_MONSTER], szone: [{ code: trap }] });
			const selected: number[] = [];
			duel.battleAction = (msg) => {
				const attacker = msg.attackableCards.find(
					(card) => card.code === [DARK_ELF, BLUE_EYES, DARK_ELF][selected.length],
				);
				if (!attacker) return msg.prepareResponse(BattleCmdType.TO_EP);
				selected.push(attacker.code);
				return msg.prepareResponse(BattleCmdType.ATTACK, attacker);
			};
			duel.selectChainIndex = (msg) => {
				const index = msg.chains.findIndex((card) => card.code === trap && selected.length === 1);
				return index < 0 ? null : index;
			};
			duel.answerYesNo = () => false;
			const messages = finishBattle(duel, format);
			expect(selected).toEqual(attackOrder);
			expect(messages.filter((msg) => msg instanceof YGOProMsgPayLpCost)).toHaveLength(payments);
		});
	});

	it("opens a new attack declaration window when the same monster attacks again", async () => {
		await withDuel((duel) => {
			duel.place(1, { mzone: [{ code: DARK_ELF }] });
			duel.place(0, {
				grave: [REVIVED_MONSTER],
				szone: [{ code: CALL_OF_THE_HAUNTED }, { code: SAKURETSU_ARMOR }],
			});
			let attacks = 0;
			duel.battleAction = (msg) => {
				const attacker = msg.attackableCards[0];
				if (!attacker) return msg.prepareResponse(BattleCmdType.TO_EP);
				attacks++;
				return msg.prepareResponse(BattleCmdType.ATTACK, attacker);
			};
			let armorActivated = false;
			duel.selectChainIndex = (msg) => {
				const expected = attacks === 1 ? CALL_OF_THE_HAUNTED : SAKURETSU_ARMOR;
				const index = msg.chains.findIndex((card) => card.code === expected);
				if (index < 0) return null;
				if (expected === SAKURETSU_ARMOR) armorActivated = true;
				return index;
			};
			duel.answerYesNo = () => false;
			finishBattle(duel, GOAT);
			expect(attacks).toBe(2);
			expect(armorActivated).toBe(true);
			expect(duel.queryFieldCount(1, C.LOCATION_GRAVE)).toBe(1);
		});
	});
});
