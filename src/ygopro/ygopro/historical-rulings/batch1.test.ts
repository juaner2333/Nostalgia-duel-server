import { HistoricalRulingsDriver } from "@test-support/wasm/HistoricalRulingsDriver";
import {
	BattleCmdType,
	IdleCmdType,
	OcgcoreScriptConstants as C,
	YGOProMsgChainSolving,
	YGOProMsgDamage,
	YGOProMsgDraw,
	YGOProMsgMove,
	YGOProMsgNewTurn,
	YGOProMsgSelectCard,
	YGOProMsgShuffleDeck,
	YGOProMsgSelectIdleCmd,
} from "ygopro-msg-encode";

const FODDER = 70095154; // サイバー・ドラゴン (ATK 2100, dragon, machine)

/** activate the given code from the idle command whenever it is offered */
function activateOnIdle(
	duel: { idleAction: (msg: YGOProMsgSelectIdleCmd) => Uint8Array },
	code: number,
) {
	duel.idleAction = (msg) => {
		const activatable = msg.activatableCards.find((a) => a.code === code);
		return activatable
			? msg.prepareResponse(IdleCmdType.ACTIVATE, activatable)
			: msg.prepareResponse(IdleCmdType.TO_EP);
	};
}

/** pick select-card entries by code (in order), fall back to the first entry */
function selectByCodes(
	duel: { selectCardIndices: (msg: YGOProMsgSelectCard) => number[] },
	codes: number[],
) {
	duel.selectCardIndices = (msg) => {
		const indices: number[] = [];
		for (const code of codes) {
			const index = msg.cards.findIndex((c) => c.code === code);
			if (index !== -1) {
				indices.push(index);
			}
		}
		return indices.length > 0 ? indices : [0];
	};
}

function countMovesToHand(seen: unknown[], codes: number[]): number {
	let count = 0;
	for (const msg of seen) {
		if (
			msg instanceof YGOProMsgMove &&
			msg.current.location === C.LOCATION_HAND &&
			codes.includes(msg.code)
		) {
			count++;
		}
	}
	return count;
}

function countMovesToGrave(seen: unknown[], codes: number[]): number {
	let count = 0;
	for (const msg of seen) {
		if (
			msg instanceof YGOProMsgMove &&
			msg.current.location === C.LOCATION_GRAVE &&
			codes.includes(msg.code)
		) {
			count++;
		}
	}
	return count;
}

function countSpSummons(seen: unknown[], codes: number[]): number {
	let count = 0;
	for (const msg of seen) {
		if (
			msg instanceof YGOProMsgMove &&
			msg.current.location === C.LOCATION_MZONE &&
			codes.includes(msg.code)
		) {
			count++;
		}
	}
	return count;
}

describe("historical card rulings batch 1", () => {
	it("95727991 catapult turtle activates twice in the same turn", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		duel.place(0, { mzone: [{ code: 95727991 }, { code: FODDER }] });
		duel.place(1, { mzone: [{ code: FODDER }] });
		activateOnIdle(duel, 95727991);
		duel.selectCardIndices = (msg) => {
			if (msg.cards.length > 1) {
				const fodder = msg.cards.findIndex((c) => c.code !== 95727991);
				if (fodder !== -1) return [fodder];
			}
			return [0];
		};
		duel.start();
		let newTurns = 0;
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 2;
		});
		const damages = duel.messagesSince(0).filter((m) => m instanceof YGOProMsgDamage).length;
		expect(damages).toBe(2);
		duel.endDuel();
		driver.finalize();
	});

	it("26202165 sangan does not lock the searched card for the turn", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		// cannon soldier (ATK 1400) is the search target and has an ignition effect
		duel.place(0, {
			mzone: [{ code: 26202165 }, { code: FODDER }],
			hand: [19230407, FODDER, FODDER, FODDER, FODDER],
		});
		duel.place(1, { mzone: [{ code: FODDER }] });
		duel.place(0, { deck: [FODDER, FODDER, FODDER, FODDER, FODDER, 11384280] });
		duel.idleAction = (msg) => {
			const offering = msg.activatableCards.find((a) => a.code === 19230407);
			if (offering) {
				return msg.prepareResponse(IdleCmdType.ACTIVATE, offering);
			}
			const summon = msg.summonableCards.find((a) => a.code === 11384280);
			if (summon) {
				return msg.prepareResponse(IdleCmdType.SUMMON, summon);
			}
			const cannon = msg.activatableCards.find((a) => a.code === 11384280);
			if (cannon) {
				return msg.prepareResponse(IdleCmdType.ACTIVATE, cannon);
			}
			return msg.prepareResponse(IdleCmdType.TO_EP);
		};
		duel.selectCardIndices = (msg) => {
			if (msg.cards.some((c) => c.code === 26202165)) {
				return [msg.cards.findIndex((c) => c.code === 26202165)];
			}
			if (msg.cards.some((c) => c.code === FODDER)) {
				return [msg.cards.findIndex((c) => c.code === FODDER)];
			}
			return [0];
		};
		duel.start();
		let newTurns = 0;
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 2;
		});
		const damages = duel
			.messagesSince(0)
			.filter((m) => m instanceof YGOProMsgDamage && m.value === 500);
		// the cannon soldier's 500 damage resolved -> it was searchable AND activatable
		expect(damages.length).toBeGreaterThanOrEqual(1);
		duel.endDuel();
		driver.finalize();
	});

	it("50321796 brionac bounces own and opponent cards repeatedly in the same turn", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		duel.place(0, {
			mzone: [{ code: 50321796 }, { code: FODDER }],
			hand: [FODDER, FODDER, FODDER, FODDER, FODDER],
		});
		duel.place(1, { mzone: [{ code: FODDER }, { code: FODDER }, { code: FODDER }] });
		let activations = 0;
		duel.idleAction = (msg) => {
			const activatable = msg.activatableCards.find((a) => a.code === 50321796);
			if (activatable && activations < 2) {
				activations++;
				return msg.prepareResponse(IdleCmdType.ACTIVATE, activatable);
			}
			return msg.prepareResponse(IdleCmdType.TO_EP);
		};
		duel.selectUnselectTargetCount = () => 2;
		duel.selectCardIndices = (msg) => {
			// the upstream cost prompt (SelectMatchingCard) lists the hand and asks
			// for 1..rt cards; discard two to prove the two-bounce behavior
			if (
				msg.cards.length > 0 &&
				msg.cards.every((c) => c.code === FODDER && c.location === C.LOCATION_HAND)
			) {
				return msg.max >= 2 ? [0, 1] : [0];
			}
			// own monster first (proves own-field targets), then opponent cards
			const own = msg.cards.findIndex((c) => c.code === FODDER && c.controller === 0);
			const opp = msg.cards.map((c, i) => (c.controller === 1 ? i : -1)).filter((i) => i !== -1);
			const picks = [...(own === -1 ? [] : [own]), ...opp].slice(0, msg.min);
			return picks.length > 0 ? picks : [0];
		};
		duel.start();
		let newTurns = 0;
		const marker = duel.messageCount();
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 2;
		});
		const seen = duel.messagesSince(marker);
		const bounced = countMovesToHand(seen, [FODDER]);
		const ownBounced = seen.filter(
			(m) =>
				m instanceof YGOProMsgMove &&
				m.current.location === C.LOCATION_HAND &&
				m.code === FODDER &&
				m.current.controller === 0,
		).length;
		expect(ownBounced).toBe(1); // our own monster was bounced too
		expect(bounced).toBe(4); // two activations x two bounces each
		duel.endDuel();
		driver.finalize();
	});

	it("70583986 dewloren lets a second copy use its soft once-per-turn effect", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		duel.place(0, {
			mzone: [{ code: 70583986 }, { code: 70583986 }, { code: FODDER }, { code: FODDER }],
			hand: [FODDER, FODDER, FODDER, FODDER, FODDER],
		});
		duel.place(1, { mzone: [{ code: FODDER }] });
		activateOnIdle(duel, 70583986);
		duel.selectUnselectTargetCount = () => 1;
		duel.selectCardIndices = (msg) => {
			const own = msg.cards.findIndex((c) => c.code === FODDER && c.controller === 0);
			return [own === -1 ? 0 : own];
		};
		duel.start();
		let newTurns = 0;
		const marker = duel.messageCount();
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 2;
		});
		const seen = duel.messagesSince(marker);
		// each copy bounced one of our own face-up monsters
		expect(countMovesToHand(seen, [FODDER])).toBe(2);
		duel.endDuel();
		driver.finalize();
	});

	it("88264978 redmd lets a second copy special summon in the same turn", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		const DRAGON = 14943837; // デブリ・ドラゴン (dragon, freely special summonable)
		duel.place(0, {
			mzone: [{ code: 88264978 }, { code: 88264978 }],
			grave: [DRAGON, DRAGON],
			hand: [FODDER, FODDER, FODDER, FODDER, FODDER],
		});
		duel.place(1, { mzone: [{ code: FODDER }] });
		activateOnIdle(duel, 88264978);
		duel.selectCardIndices = (msg) => {
			const dragon = msg.cards.findIndex((c) => c.code === DRAGON);
			return [dragon === -1 ? 0 : dragon];
		};
		duel.start();
		let newTurns = 0;
		const marker = duel.messageCount();
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 2;
		});
		const seen = duel.messagesSince(marker);
		const summons = countSpSummons(seen, [14943837]);
		expect(summons).toBe(2);
		duel.endDuel();
		driver.finalize();
	});

	it("25862681 ancient fairy dragon lets a second copy special summon in the same turn", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		duel.place(0, {
			mzone: [{ code: 25862681 }, { code: 25862681 }],
			hand: [21454943, 21454943, FODDER, FODDER, FODDER],
		});
		duel.place(1, { mzone: [{ code: FODDER }] });
		activateOnIdle(duel, 25862681);
		duel.start();
		let newTurns = 0;
		const marker = duel.messageCount();
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 2;
		});
		const seen = duel.messagesSince(marker);
		const summons = countSpSummons(seen, [21454943]);
		expect(summons).toBe(2);
		duel.endDuel();
		driver.finalize();
	});

	it("96782886 mental master cannot release itself and activates repeatedly", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		duel.place(0, {
			mzone: [{ code: 96782886 }, { code: 21454943 }, { code: 21454943 }],
			hand: [FODDER, FODDER, FODDER, FODDER, FODDER],
		});
		duel.place(1, { mzone: [{ code: FODDER }] });
		duel.place(0, { deck: [FODDER, FODDER, FODDER, FODDER, FODDER, 21454943, 21454943] });
		activateOnIdle(duel, 96782886);
		const releaseLists: number[][] = [];
		duel.selectCardIndices = (msg) => {
			if (msg.cards.some((c) => c.code === 21454943 && c.location === C.LOCATION_MZONE)) {
				const commander = msg.cards.findIndex((c) => c.code === 21454943);
				releaseLists.push(msg.cards.map((c) => c.code));
				return [commander];
			}
			if (msg.cards.some((c) => c.code === 21454943 && c.location === C.LOCATION_DECK)) {
				return [msg.cards.findIndex((c) => c.code === 21454943)];
			}
			return [0];
		};
		duel.start();
		let newTurns = 0;
		const marker = duel.messageCount();
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 2;
		});
		const seen = duel.messagesSince(marker);
		for (const list of releaseLists) {
			expect(list).not.toContain(96782886);
		}
		const summons = countSpSummons(seen, [21454943]);
		expect(summons).toBe(2);
		duel.endDuel();
		driver.finalize();
	});

	it("77565204 future fusion sends materials immediately at activation", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		const MAT_A = 97023549; // エトワール・サイバー
		const MAT_B = 11460577; // バーチャル・キャット
		duel.place(0, {
			hand: [77565204, FODDER, FODDER, FODDER, FODDER],
			extra: [10248389],
			deck: [FODDER, FODDER, FODDER, FODDER, FODDER, MAT_A, MAT_B],
		});
		duel.place(1, { mzone: [{ code: FODDER }] });
		activateOnIdle(duel, 77565204);
		duel.selectUnselectTargetCount = () => 2;
		duel.selectCardIndices = (msg) => {
			if (msg.cards.some((c) => c.code === 10248389)) {
				return [msg.cards.findIndex((c) => c.code === 10248389)];
			}
			const picks = [MAT_A, MAT_B]
				.map((code) => msg.cards.findIndex((c) => c.code === code))
				.filter((i) => i !== -1);
			return picks.length > 0 ? picks : [0];
		};
		duel.start();
		let newTurns = 0;
		const marker = duel.messageCount();
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 2;
		});
		const seen = duel.messagesSince(marker);
		// materials went to the grave during the activation's own chain resolution
		const chainStart = seen.findIndex((m) => m.constructor.name === "YGOProMsgChaining");
		const chainEnd = seen.findIndex((m) => m.constructor.name === "YGOProMsgChainSolved");
		const graveMoves = seen
			.slice(chainStart === -1 ? 0 : chainStart, chainEnd === -1 ? seen.length : chainEnd)
			.filter(
				(m) =>
					m instanceof YGOProMsgMove &&
					m.current.location === C.LOCATION_GRAVE &&
					(m.code === MAT_A || m.code === MAT_B),
			);
		expect(graveMoves.length).toBe(2);
		duel.endDuel();
		driver.finalize();
	});

	it("21502796 ryko selects its destroy target at activation", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		duel.place(0, { hand: [21502796, FODDER, FODDER, FODDER, FODDER] });
		duel.place(1, { mzone: [{ code: FODDER }] });
		duel.idleAction = (msg) => {
			const mset = msg.msetableCards.find((a) => a.code === 21502796);
			if (mset) {
				return msg.prepareResponse(IdleCmdType.MSET, mset);
			}
			return msg.canBp
				? msg.prepareResponse(IdleCmdType.TO_BP)
				: msg.prepareResponse(IdleCmdType.TO_EP);
		};
		duel.battleAction = (msg) => {
			const attacker = msg.attackableCards.find((a) => a.code === FODDER);
			return attacker
				? msg.prepareResponse(BattleCmdType.ATTACK, attacker)
				: msg.prepareResponse(BattleCmdType.TO_EP);
		};
		duel.start();
		const marker = duel.messageCount();
		let newTurns = 0;
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 3;
		});
		const seen = duel.messagesSince(marker);
		const firstSolving = seen.findIndex((m) => m instanceof YGOProMsgChainSolving);
		const selectCards = seen
			.map((m, i) => (m instanceof YGOProMsgSelectCard ? i : -1))
			.filter((i) => i !== -1);
		expect(firstSolving).not.toBe(-1);
		expect(selectCards.length).toBeGreaterThanOrEqual(2);
		// the destroy-target select for the flip effect happens before resolution
		expect(Math.max(...selectCards)).toBeLessThan(firstSolving);
		// the three-card mill must not shuffle the remaining deck
		expect(seen.some((m) => m instanceof YGOProMsgShuffleDeck)).toBe(false);
		duel.endDuel();
		driver.finalize();
	});

	it("25862681 ancient fairy dragon can search a field spell with the same code as the destroyed one", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		// no level-4-or-lower monster in hand, so only the destroy/search effect is available
		duel.place(0, {
			mzone: [{ code: 25862681 }],
			fzone: 295517,
			hand: [FODDER, FODDER, FODDER, FODDER, FODDER],
		});
		duel.place(1, { mzone: [{ code: FODDER }] });
		duel.place(0, { deck: [FODDER, FODDER, FODDER, FODDER, FODDER, 295517] });
		activateOnIdle(duel, 25862681);
		duel.selectCardIndices = (msg) => {
			const field = msg.cards.findIndex((c) => c.code === 295517);
			return [field === -1 ? 0 : field];
		};
		duel.start();
		let newTurns = 0;
		const marker = duel.messageCount();
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 2;
		});
		const seen = duel.messagesSince(marker);
		// the second copy of the destroyed field spell reached the hand
		expect(countMovesToHand(seen, [295517])).toBe(1);
		duel.endDuel();
		driver.finalize();
	});

	it("80168720 darkness approaches flips the target into face-down attack", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		duel.place(0, { hand: [80168720, FODDER, FODDER, FODDER, FODDER] });
		duel.place(1, { mzone: [{ code: FODDER }] });
		activateOnIdle(duel, 80168720);
		duel.selectCardIndices = (msg) => {
			const target = msg.cards.findIndex((c) => c.code === FODDER && c.controller === 1);
			if (target !== -1) return [target];
			if (msg.min >= 2) return [0, 1];
			return [0];
		};
		duel.start();
		let newTurns = 0;
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 2;
		});
		const target = duel.queryCard(1, C.LOCATION_MZONE, 0);
		expect(target.card?.position).toBe(C.POS_FACEDOWN_ATTACK);
		duel.endDuel();
		driver.finalize();
	});

	it("16226786 deep sea assassin can target another copy of itself", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		duel.place(0, {
			hand: [16226786, 72892473, FODDER, FODDER, FODDER, FODDER],
			grave: [16226786],
		});
		duel.place(1, { hand: [FODDER, FODDER, FODDER, FODDER, FODDER] });
		activateOnIdle(duel, 72892473);
		const targetLists: number[][] = [];
		duel.selectCardIndices = (msg) => {
			if (msg.cards.some((c) => c.code === 16226786 && c.location === C.LOCATION_GRAVE)) {
				targetLists.push(msg.cards.map((c) => c.code));
				return [msg.cards.findIndex((c) => c.code === 16226786)];
			}
			return [0];
		};
		duel.start();
		let newTurns = 0;
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 2;
		});
		const seen = duel.messagesSince(0);
		expect(targetLists.length).toBeGreaterThan(0);
		// only the other copy is selectable, not the resolving card itself
		expect(targetLists[0]).toEqual([16226786]);
		expect(targetLists[0].length).toBe(1);
		const moved = countMovesToHand(seen, [16226786]);
		expect(moved).toBe(1);
		duel.endDuel();
		driver.finalize();
	});
});
