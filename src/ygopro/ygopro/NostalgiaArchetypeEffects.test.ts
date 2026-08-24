import fs from "node:fs";
import path from "node:path";
import { HistoricalRulingsDriver } from "@test-support/wasm/HistoricalRulingsDriver";
import {
	BattleCmdType,
	IdleCmdType,
	OcgcoreScriptConstants as C,
	YGOProMsgAttack,
	YGOProMsgMove,
	YGOProMsgNewTurn,
} from "ygopro-msg-encode";

const F = 70095154; // サイバー・ドラゴン (deck filler / battle attacker)

// 六武众契约卡
const SHADOW_WARRIOR = 1498130; // 六武众的影武者 (lvl 2)
const DOJO = 47436247; // 紫炎的道场 (base script, new 0x103d query)
const RISHI = 54031490; // 紫炎的狼烟 (base script, new 0x103d query)
const SIX_GATES = 27970830; // 六武之门 (format override, new 0x103d query)
const MASTER_SIX = 83039729; // 六武众的师范 (format override, OLD 0x3d query)

// 剑斗兽契约卡
const GLADIATOR_POWER = 55136228; // 剑斗兽的底力 (format override, new 0x1019 query)
const GLADIATOR_NET = 612115; // 剑斗兽 网斗 (1200 ATK)
const GLADIATOR_DARIUS = 25924653; // 剑斗兽 马斗 (format override, OLD 0x19 query)

// 地缚神契约卡
const CCAPAC = 46263076; // 地缚神 卡帕克·阿普 (format override, new 0x1021 query)
const CUSILLU = 33537328; // 地缚神 库西略 (same archetype unique group)
const UMI = 22702055; // 海 (vanilla field spell)

// 荷鲁斯 / 魅惑女王契约卡
const HORUS_SERVANT = 9264485; // 荷鲁斯的仆人 (new 0x119d query)
const HORUS_LV4 = 75830094; // 荷鲁斯之黑炎龙 LV4 (new 0x119d0041)
const SHRINK = 55713623; // 收缩 (quick-play, targets one face-up monster)
const ALLURE_LV5 = 23756165; // 魅惑的女王 LV5 (new 0x410003)
const QUEEN_GUARD = 71411377; // 女王亲卫队 (new 0x3 query)

const DOR_DORA = 43586926; // ドル・ドラ (ATK 0, attack target for 马斗)

const CARD_COUNTER_BUSHIDO = 0x3;

type DefenderStats = { controller: number; location: number; sequence: number };

/** flatten the runtime battle stats (location is a number at runtime, not an object) */
function flatDefender(stats: { location: unknown }): DefenderStats {
	return stats as unknown as DefenderStats;
}

function movesTo(seen: unknown[], code: number, location: number): number {
	return seen.filter(
		(m) => m instanceof YGOProMsgMove && m.current?.location === location && m.code === code,
	).length;
}

function mzoneCodes(
	duel: { queryFieldCards: (player: number, location: number) => unknown },
	player: number,
): number[] {
	const result = duel.queryFieldCards(player, C.LOCATION_MZONE) as {
		cards: Array<{ code: number }>;
	};
	return (result.cards ?? []).map((card) => card.code);
}

function runTurns(
	duel: { runUntil: (until: (msg: unknown, seen: unknown[]) => boolean) => unknown[] },
	target: number,
): unknown[] {
	let turns = 0;
	return duel.runUntil((msg) => {
		if (msg instanceof YGOProMsgNewTurn) turns++;
		return turns >= target;
	});
}

function activateOnIdle(
	duel: { idleAction: (msg: { activatableCards: Array<{ code: number }> }) => unknown },
	code: number,
): void {
	duel.idleAction = (msg: any) => {
		const activatable = msg.activatableCards.find((a: { code: number }) => a.code === code);
		return activatable
			? msg.prepareResponse(IdleCmdType.ACTIVATE, activatable)
			: msg.prepareResponse(IdleCmdType.TO_EP);
	};
}

function summonOnIdle(duel: { idleAction: (msg: never) => unknown }, code: number): void {
	duel.idleAction = (msg: any) => {
		const activatable = msg.summonableCards.find((a: { code: number }) => a.code === code);
		return activatable
			? msg.prepareResponse(IdleCmdType.SUMMON, activatable)
			: msg.prepareResponse(IdleCmdType.TO_EP);
	};
}

function specialSummonOnIdle(duel: { idleAction: (msg: never) => unknown }, code: number): void {
	duel.idleAction = (msg: any) => {
		const activatable = msg.spSummonableCards.find((a: { code: number }) => a.code === code);
		return activatable
			? msg.prepareResponse(IdleCmdType.SPSUMMON, activatable)
			: msg.prepareResponse(IdleCmdType.TO_EP);
	};
}

function pickCardsByCode(
	duel: { selectCardIndices: (msg: never) => number[] },
	code: number,
): void {
	duel.selectCardIndices = (msg: any) => {
		const index = msg.cards.findIndex((card: { code: number }) => card.code === code);
		return index === -1 ? [0] : [index];
	};
}

/** run the duel to the start of the next turn and then read the given mzone */
async function withFormat(formatId: "1103" | "1109") {
	const driver = await HistoricalRulingsDriver.create(formatId);
	const duel = driver.createDuel();
	return { driver, duel };
}

describe("nostalgia archetype setcode effects", () => {
	describe.each(["1103", "1109"] as const)("format %s", (formatId) => {
		it("adds one bushido counter to 紫炎的道场 when a six samurai is summoned", async () => {
			const { driver, duel } = await withFormat(formatId);
			try {
				duel.place(0, { fzone: DOJO, hand: [SHADOW_WARRIOR, F, F, F, F] });
				duel.place(1, {});
				summonOnIdle(duel, SHADOW_WARRIOR);
				duel.start();
				runTurns(duel, 2);
				const dojo = duel.queryCard(0, C.LOCATION_SZONE, 5).card as {
					counters?: Array<{ type: number; count: number }>;
				};
				expect(dojo.counters).toEqual([{ type: CARD_COUNTER_BUSHIDO, count: 1 }]);
			} finally {
				duel.endDuel();
				driver.finalize();
			}
		});

		it("searches a level-3-or-below six samurai to hand with 紫炎的狼烟", async () => {
			const { driver, duel } = await withFormat(formatId);
			try {
				duel.place(0, { hand: [RISHI, F, F, F, F], deck: [F, F, F, F, F, SHADOW_WARRIOR] });
				duel.place(1, {});
				activateOnIdle(duel, RISHI);
				pickCardsByCode(duel, SHADOW_WARRIOR);
				duel.start();
				const seen = runTurns(duel, 2);
				expect(movesTo(seen, SHADOW_WARRIOR, C.LOCATION_HAND)).toBeGreaterThanOrEqual(1);
				expect(movesTo(seen, RISHI, C.LOCATION_GRAVE)).toBeGreaterThanOrEqual(1);
			} finally {
				duel.endDuel();
				driver.finalize();
			}
		});

		it("loads the 六武之门 format override and adds two counters on a six samurai summon", async () => {
			const { driver, duel } = await withFormat(formatId);
			try {
				duel.place(0, { fzone: SIX_GATES, hand: [SHADOW_WARRIOR, F, F, F, F] });
				duel.place(1, {});
				summonOnIdle(duel, SHADOW_WARRIOR);
				duel.start();
				runTurns(duel, 2);
				const gates = duel.queryCard(0, C.LOCATION_SZONE, 5).card as {
					counters?: Array<{ type: number; count: number }>;
				};
				expect(gates.counters).toEqual([{ type: CARD_COUNTER_BUSHIDO, count: 2 }]);
			} finally {
				duel.endDuel();
				driver.finalize();
			}
		});

		it("loads the 剑斗兽的底力 format override and targets a gladiator beast", async () => {
			const { driver, duel } = await withFormat(formatId);
			try {
				duel.place(0, { mzone: [{ code: GLADIATOR_NET }], hand: [GLADIATOR_POWER, F, F, F, F] });
				duel.place(1, {});
				activateOnIdle(duel, GLADIATOR_POWER);
				pickCardsByCode(duel, GLADIATOR_NET);
				duel.start();
				const seen = runTurns(duel, 2);
				expect(movesTo(seen, GLADIATOR_POWER, C.LOCATION_GRAVE)).toBeGreaterThanOrEqual(1);
			} finally {
				duel.endDuel();
				driver.finalize();
			}
		});

		it("loads the 地缚神 卡帕克·阿普 format override and enforces the earthbound unique rule", async () => {
			const { driver, duel } = await withFormat(formatId);
			try {
				duel.place(0, {
					fzone: UMI,
					mzone: [{ code: CCAPAC }, { code: CUSILLU }],
					hand: [F, F, F, F, F],
				});
				duel.place(1, {});
				duel.idleAction = (msg: any) => msg.prepareResponse(IdleCmdType.TO_EP);
				duel.start();
				runTurns(duel, 3);
				const codes = mzoneCodes(duel, 0).filter((code) => code === CCAPAC || code === CUSILLU);
				// the unique rule keeps exactly one face-up earthbound immortal
				expect(codes).toHaveLength(1);
			} finally {
				duel.endDuel();
				driver.finalize();
			}
		});

		it("lets 荷鲁斯的仆人 exclude horus monsters from the opponent's targeting options", async () => {
			const { driver, duel } = await withFormat(formatId);
			try {
				// the opponent (turn 2) activates the quick-play 收缩 against the
				// servant-controlled 荷鲁斯 monsters; the servant must keep the LV
				// monsters out of the offered target list
				duel.place(0, { mzone: [{ code: HORUS_SERVANT }], hand: [F, F, F, F, F] });
				duel.place(1, { mzone: [{ code: HORUS_LV4 }], hand: [SHRINK, F, F, F, F] });
				activateOnIdle(duel, SHRINK);
				const offeredTargets: number[] = [];
				duel.selectCardIndices = (msg: any) => {
					for (const card of msg.cards) {
						offeredTargets.push(card.code);
					}
					return [0];
				};
				duel.start();
				runTurns(duel, 3);
				// the opponent really activated 收缩 and got a target list, and the
				// protected LV monster is never offered as an effect target
				expect(offeredTargets.length).toBeGreaterThan(0);
				expect(offeredTargets).toContain(HORUS_SERVANT);
				expect(offeredTargets).not.toContain(HORUS_LV4);
				expect(mzoneCodes(duel, 0)).toContain(HORUS_SERVANT);
			} finally {
				duel.endDuel();
				driver.finalize();
			}
		});

		it("lets 女王亲卫队 protect allure queens from battle targets", async () => {
			const { driver, duel } = await withFormat(formatId);
			try {
				duel.place(0, {
					mzone: [{ code: ALLURE_LV5 }, { code: QUEEN_GUARD }],
					hand: [F, F, F, F, F],
				});
				duel.place(1, { mzone: [{ code: F }] });
				duel.idleAction = (msg: any) =>
					msg.canBp
						? msg.prepareResponse(IdleCmdType.TO_BP)
						: msg.prepareResponse(IdleCmdType.TO_EP);
				let attackTried = false;
				duel.battleAction = (msg: any) => {
					if (!attackTried) {
						const attacker = msg.attackableCards.find((a: { code: number }) => a.code === F);
						if (attacker) {
							attackTried = true;
							return msg.prepareResponse(BattleCmdType.ATTACK, attacker);
						}
					}
					return msg.prepareResponse(BattleCmdType.TO_EP);
				};
				duel.start();
				const defenders: DefenderStats[] = [];
				let turns = 0;
				duel.runUntil((msg) => {
					if (msg instanceof YGOProMsgAttack) {
						defenders.push(flatDefender(msg.defender));
					}
					if (msg instanceof YGOProMsgNewTurn) turns++;
					return turns >= 3;
				});
				// the attack really happened and was redirected to the guard
				// (sequence 1) instead of the protected allure queen (sequence 0)
				expect(defenders.length).toBeGreaterThan(0);
				expect(defenders.some((defender) => defender.sequence === 1)).toBe(true);
				expect(defenders.some((defender) => defender.sequence === 0)).toBe(false);
			} finally {
				duel.endDuel();
				driver.finalize();
			}
		});

		it("keeps 六武众的师范 special summoning with its old 0x3d query", async () => {
			const { driver, duel } = await withFormat(formatId);
			try {
				duel.place(0, { mzone: [{ code: SHADOW_WARRIOR }], hand: [MASTER_SIX, F, F, F, F] });
				duel.place(1, {});
				specialSummonOnIdle(duel, MASTER_SIX);
				duel.start();
				runTurns(duel, 2);
				expect(mzoneCodes(duel, 0)).toContain(MASTER_SIX);
			} finally {
				duel.endDuel();
				driver.finalize();
			}
		});

		it("keeps 剑斗兽 马斗 tagging out with its old 0x19 query", async () => {
			const { driver, duel } = await withFormat(formatId);
			try {
				duel.place(0, {
					mzone: [{ code: GLADIATOR_DARIUS }],
					hand: [F, F, F, F, F],
					deck: [F, F, F, F, F, GLADIATOR_NET],
				});
				duel.place(1, { mzone: [{ code: DOR_DORA }] });
				duel.idleAction = (msg: any) =>
					msg.canBp
						? msg.prepareResponse(IdleCmdType.TO_BP)
						: msg.prepareResponse(IdleCmdType.TO_EP);
				duel.battleAction = (msg: any) => {
					const attacker = msg.attackableCards.find(
						(a: { code: number }) => a.code === GLADIATOR_DARIUS,
					);
					return attacker
						? msg.prepareResponse(BattleCmdType.ATTACK, attacker)
						: msg.prepareResponse(BattleCmdType.TO_EP);
				};
				duel.selectChainIndex = (msg: any) => {
					const index = msg.chains.findIndex(
						(chain: { code: number }) => chain.code === GLADIATOR_DARIUS,
					);
					return index >= 0 ? index : null;
				};
				pickCardsByCode(duel, GLADIATOR_NET);
				duel.start();
				runTurns(duel, 4);
				const codes = mzoneCodes(duel, 0);
				// after battling, 马斗 returns to the deck and special summons 网斗 from the deck
				expect(codes).toContain(GLADIATOR_NET);
				expect(codes).not.toContain(GLADIATOR_DARIUS);
			} finally {
				duel.endDuel();
				driver.finalize();
			}
		});
	});
});

describe("nostalgia archetype resources", () => {
	it("keeps the 706 override scripts byte-identical across the two formats", () => {
		for (const cardId of [SIX_GATES, GLADIATOR_POWER, CCAPAC, MASTER_SIX, GLADIATOR_DARIUS]) {
			const a = fs.readFileSync(
				path.join(
					__dirname,
					"../../..",
					"nostalgia-resources",
					"ygopro",
					"formats",
					"1103",
					"script",
					`c${cardId}.lua`,
				),
			);
			const b = fs.readFileSync(
				path.join(
					__dirname,
					"../../..",
					"nostalgia-resources",
					"ygopro",
					"formats",
					"1109",
					"script",
					`c${cardId}.lua`,
				),
			);
			expect(a.equals(b)).toBe(true);
		}
	});
});
