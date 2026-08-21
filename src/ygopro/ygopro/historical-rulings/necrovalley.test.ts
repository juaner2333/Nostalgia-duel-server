import fs from "node:fs";
import path from "node:path";
import { HistoricalRulingsDriver, RESOURCE_ROOT } from "@test-support/wasm/HistoricalRulingsDriver";
import {
	BattleCmdType,
	IdleCmdType,
	OcgcoreScriptConstants as C,
	YGOProMsgChainDisabled,
	YGOProMsgMove,
	YGOProMsgNewTurn,
} from "ygopro-msg-encode";

const NECROVALLEY = 47355498;
const FODDER = 70095154; // サイバー・ドラゴン

/** activate the given code from the idle command whenever it is offered */
function activateOnIdle(duel: { idleAction: (msg: unknown) => unknown }, code: number) {
	duel.idleAction = (msg: any) => {
		const activatable = msg.activatableCards.find((a: { code: number }) => a.code === code);
		return activatable
			? msg.prepareResponse(IdleCmdType.ACTIVATE, activatable)
			: msg.prepareResponse(IdleCmdType.TO_EP);
	};
}

function movesToHand(seen: unknown[], code: number): number {
	return seen.filter(
		(m) => m instanceof YGOProMsgMove && m.current.location === C.LOCATION_HAND && m.code === code,
	).length;
}

function movesToMzone(seen: unknown[], code: number): number {
	return seen.filter(
		(m) => m instanceof YGOProMsgMove && m.current.location === C.LOCATION_MZONE && m.code === code,
	).length;
}

describe("historical card rulings: necrovalley A-version", () => {
	it("47355498 blocks banishing cards from the graveyard", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		duel.place(0, { fzone: NECROVALLEY, hand: [24508238, FODDER, FODDER, FODDER, FODDER] });
		duel.place(1, { grave: [FODDER] });
		activateOnIdle(duel, 24508238);
		duel.selectCardIndices = (msg) => {
			if (msg.cards.some((c) => c.code === FODDER && c.location === C.LOCATION_GRAVE)) {
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
		// the targeted card is still in the opponent's graveyard
		expect(duel.queryFieldCount(1, C.LOCATION_GRAVE)).toBe(1);
		duel.endDuel();
		driver.finalize();
	});

	it("47355498 does not negate a non-targeting effect moving only its own handler", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		// ドル・ドラ revives itself from the grave at the end phase (non-targeting)
		duel.place(0, {
			fzone: NECROVALLEY,
			mzone: [{ code: 43586926 }],
			hand: [19230407, FODDER, FODDER, FODDER, FODDER],
		});
		duel.place(1, { mzone: [{ code: FODDER }] });
		activateOnIdle(duel, 19230407);
		duel.selectCardIndices = (msg) => {
			const dordora = msg.cards.findIndex((c) => c.code === 43586926);
			return [dordora === -1 ? 0 : dordora];
		};
		duel.start();
		let newTurns = 0;
		const marker = duel.messageCount();
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 2;
		});
		// the self-revival resolved despite necrovalley
		expect(movesToMzone(duel.messagesSince(marker), 43586926)).toBe(1);
		duel.endDuel();
		driver.finalize();
	});

	it("47355498 negates a targeting effect that chooses its own handler", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		// ギガンテック・ファイター revives a warrior from the grave targeting itself
		duel.place(0, { fzone: NECROVALLEY, mzone: [{ code: 23693634 }] });
		duel.place(1, { mzone: [{ code: 65192027 }] }); // ダーク・アームド・ドラゴン 2800 > 2200
		duel.idleAction = (msg) => {
			return msg.canBp
				? msg.prepareResponse(IdleCmdType.TO_BP)
				: msg.prepareResponse(IdleCmdType.TO_EP);
		};
		duel.battleAction = (msg) => {
			const attacker = msg.attackableCards.find((a) => a.code === 65192027);
			return attacker
				? msg.prepareResponse(BattleCmdType.ATTACK, attacker)
				: msg.prepareResponse(BattleCmdType.TO_EP);
		};
		duel.selectCardIndices = (msg) => {
			const target = msg.cards.findIndex((c) => c.code === 23693634);
			return [target === -1 ? 0 : target];
		};
		duel.start();
		let newTurns = 0;
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 3;
		});
		// the fighter stayed in the graveyard
		expect(duel.queryFieldCount(0, C.LOCATION_MZONE)).toBe(0);
		duel.endDuel();
		driver.finalize();
	});

	it("47355498 does not negate a grave effect that only searches the deck", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		// クリッター activates in the grave and only searches the deck
		duel.place(0, {
			fzone: NECROVALLEY,
			mzone: [{ code: 26202165 }],
			hand: [19230407, FODDER, FODDER, FODDER, FODDER],
			deck: [FODDER, FODDER, FODDER, FODDER, FODDER, 11384280],
		});
		duel.place(1, { mzone: [{ code: FODDER }] });
		activateOnIdle(duel, 19230407);
		duel.selectCardIndices = (msg) => {
			const sangan = msg.cards.findIndex((c) => c.code === 26202165);
			return [sangan === -1 ? 0 : sangan];
		};
		duel.start();
		let newTurns = 0;
		const marker = duel.messageCount();
		duel.runUntil((msg) => {
			if (msg instanceof YGOProMsgNewTurn) newTurns++;
			return newTurns >= 2;
		});
		// the searched cannon soldier reached the hand
		expect(movesToHand(duel.messagesSince(marker), 11384280)).toBe(1);
		duel.endDuel();
		driver.finalize();
	});

	it("47355498 negates an effect that returns grave cards to the deck/extra deck", async () => {
		const driver = await HistoricalRulingsDriver.create("1103");
		const duel = driver.createDuel();
		// 貪欲な壺 sends five grave monsters back; the fusion monster returns to the
		// extra deck, so necrovalley must negate the whole effect
		duel.place(0, {
			fzone: NECROVALLEY,
			hand: [67169062, FODDER, FODDER, FODDER, FODDER],
			grave: [10248389, FODDER, FODDER, FODDER, FODDER],
		});
		duel.place(1, { mzone: [{ code: FODDER }] });
		activateOnIdle(duel, 67169062);
		duel.selectCardIndices = (msg) => {
			if (msg.cards.length >= 5) return [0, 1, 2, 3, 4];
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
		// the chain was negated; the fusion monster stayed in the grave
		// (the greedy jar itself joins the grave after activation)
		expect(seen.some((m) => m instanceof YGOProMsgChainDisabled)).toBe(true);
		const graveCards = duel.queryFieldCards(0, C.LOCATION_GRAVE).cards;
		expect(graveCards.some((card) => card.code === 10248389)).toBe(true);
		duel.endDuel();
		driver.finalize();
	});

	it("47355498 script checks cards returning to the extra deck (CATEGORY_TOEXTRA)", () => {
		// no 1103-whitelisted effect moves grave cards with CATEGORY_TOEXTRA, so the
		// branch is guarded at script level; the behavior is covered by the greedy jar test
		for (const formatId of ["1103", "1109"]) {
			const script = fs.readFileSync(
				path.join(RESOURCE_ROOT, "ygopro", "formats", formatId, "script", "c47355498.lua"),
				"utf8",
			);
			expect(script).toContain("CATEGORY_TOEXTRA");
		}
	});
});
