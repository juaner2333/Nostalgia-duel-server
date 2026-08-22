import fs from "node:fs";
import path from "node:path";
import {
	createOcgcoreWrapper,
	DirScriptReaderEx,
	type OcgcoreDuel,
	type OcgcoreWrapper,
} from "koishipro-core.js";
import initSqlJs from "sql.js";
import { YGOProCdb } from "ygopro-cdb-encode";
import {
	BattleCmdType,
	IdleCmdType,
	IndexResponse,
	OcgcoreScriptConstants as C,
	YGOProMsgResponseBase,
	YGOProMsgRetry,
	YGOProMsgSelectBattleCmd,
	YGOProMsgSelectCard,
	YGOProMsgSelectChain,
	YGOProMsgSelectCounter,
	YGOProMsgSelectDisField,
	YGOProMsgSelectEffectYn,
	YGOProMsgSelectIdleCmd,
	YGOProMsgSelectOption,
	YGOProMsgSelectPlace,
	YGOProMsgSelectPosition,
	YGOProMsgSelectSum,
	YGOProMsgSelectTribute,
	YGOProMsgSelectUnselectCard,
	YGOProMsgSelectYesNo,
	YGOProMsgNewPhase,
	YGOProMsgNewTurn,
	type YGOProMsgBase,
} from "ygopro-msg-encode";
import { calculateDuelOptions } from "@ygopro/utils/calculate-duel-options";
import { CardStorage } from "@ygopro/ygopro/card-storage";
import { readWhitelistCardIds } from "@ygopro/ygopro/YGOProResourceLoader";

export type FormatId = "1103" | "1109";

/** harmless monster used to pad test decks to 40 cards (サイバー・ドラゴン) */
const DEFAULT_DECK_FILLER = 70095154;

export const RESOURCE_ROOT = path.resolve(__dirname, "../../..", "nostalgia-resources");

export interface CardPlacement {
	code: number;
	player: number;
	location: number;
	sequence?: number;
	position?: number;
}

export interface PlayerSetup {
	/** monsters in the monster zone, index = zone sequence */
	mzone?: Array<{ code: number; position?: number }>;
	/** spell/trap zone cards, index = zone sequence */
	szone?: Array<{ code: number; position?: number }>;
	/** field spell zone */
	fzone?: number;
	hand?: number[];
	grave?: number[];
	/** deck from top to bottom (sequence 0 is drawn first), padded to 40 cards */
	deck?: number[];
	extra?: number[];
}

/**
 * Test-side WASM duel driver for historical ruling scenarios.
 * Loads the fixed CDB, a format-first script chain and the real
 * koishipro-core.js ocgcore, then drives message responses.
 */
export class HistoricalRulingsDriver {
	readonly formatId: FormatId;
	readonly storage: CardStorage;
	readonly formatPath: string;
	readonly basePath: string;
	private readonly wrapper: OcgcoreWrapper;

	private constructor(
		formatId: FormatId,
		storage: CardStorage,
		wrapper: OcgcoreWrapper,
		formatPath: string,
		basePath: string,
	) {
		this.formatId = formatId;
		this.storage = storage;
		this.wrapper = wrapper;
		this.formatPath = formatPath;
		this.basePath = basePath;
	}

	static async create(formatId: FormatId): Promise<HistoricalRulingsDriver> {
		const SQL = await initSqlJs();
		const cdb = new YGOProCdb(
			new SQL.Database(fs.readFileSync(path.join(RESOURCE_ROOT, "ygopro", "base", "cards.cdb"))),
		).noTexts();
		const baseStorage = CardStorage.fromCards(cdb.step());
		cdb.finalize();
		const pool = await readWhitelistCardIds(
			path.join(RESOURCE_ROOT, "ygopro", "formats", formatId, "lflist.conf"),
		);
		const storage = baseStorage.filterForFormat(pool);
		const wrapper = await createOcgcoreWrapper();
		const formatPath = path.join(RESOURCE_ROOT, "ygopro", "formats", formatId);
		const basePath = path.join(RESOURCE_ROOT, "ygopro", "base");
		wrapper.setScriptReader(await DirScriptReaderEx(formatPath, basePath));
		wrapper.setCardReader(storage.toCardReader());
		return new HistoricalRulingsDriver(formatId, storage, wrapper, formatPath, basePath);
	}

	/** Build a driver whose script chain starts with the given temp dirs (isolation tests). */
	static async createWithScriptDirs(
		formatId: FormatId,
		scriptDirs: string[],
	): Promise<HistoricalRulingsDriver> {
		const SQL = await initSqlJs();
		const cdb = new YGOProCdb(
			new SQL.Database(fs.readFileSync(path.join(RESOURCE_ROOT, "ygopro", "base", "cards.cdb"))),
		).noTexts();
		const baseStorage = CardStorage.fromCards(cdb.step());
		cdb.finalize();
		const pool = await readWhitelistCardIds(
			path.join(RESOURCE_ROOT, "ygopro", "formats", formatId, "lflist.conf"),
		);
		const storage = baseStorage.filterForFormat(pool);
		const wrapper = await createOcgcoreWrapper();
		wrapper.setScriptReader(await DirScriptReaderEx(...scriptDirs));
		wrapper.setCardReader(storage.toCardReader());
		return new HistoricalRulingsDriver(
			formatId,
			storage,
			wrapper,
			path.join(RESOURCE_ROOT, "ygopro", "formats", formatId),
			path.join(RESOURCE_ROOT, "ygopro", "base"),
		);
	}

	createDuel(): HistoricalTestDuel {
		return new HistoricalTestDuel(this, this.wrapper.createDuelV2([1, 2, 3, 4]));
	}

	finalize(): void {
		this.wrapper.finalize();
	}
}

export class HistoricalTestDuel {
	readonly driver: HistoricalRulingsDriver;
	private readonly duel: OcgcoreDuel;
	private readonly seen: YGOProMsgBase[] = [];
	private lastResponse: Uint8Array | null = null;
	private unselectPicks = 0;
	private lastMsgWasUnselect = false;
	private emptyResults = 0;

	/** current turn number (1-based) and phase, tracked from messages */
	turn = 1;
	turnPlayer = 0;
	phase = 0;

	constructor(driver: HistoricalRulingsDriver, duel: OcgcoreDuel) {
		this.driver = driver;
		this.duel = duel;
		this.duel.setPlayerInfo({ player: 0, lp: 8000, startHand: 0, drawCount: 1 });
		this.duel.setPlayerInfo({ player: 1, lp: 8000, startHand: 0, drawCount: 1 });
	}

	/** messages observed since the given marker */
	messagesSince(marker: number): YGOProMsgBase[] {
		return this.seen.slice(marker);
	}

	messageCount(): number {
		return this.seen.length;
	}

	placeRaw(
		player: number,
		location: number,
		sequence: number,
		code: number,
		position?: number,
	): void {
		this.duel.newCard({
			code,
			owner: player,
			player,
			location,
			sequence,
			position: position ?? C.POS_FACEUP,
		});
	}

	place(player: number, setup: PlayerSetup): void {
		const add = (code: number, location: number, sequence: number, position: number) => {
			this.duel.newCard({ code, owner: player, player, location, sequence, position });
		};
		(setup.mzone ?? []).forEach((entry, sequence) =>
			add(entry.code, C.LOCATION_MZONE, sequence, entry.position ?? C.POS_FACEUP_ATTACK),
		);
		(setup.szone ?? []).forEach((entry, sequence) =>
			add(entry.code, C.LOCATION_SZONE, sequence, entry.position ?? C.POS_FACEDOWN),
		);
		if (setup.fzone !== undefined) {
			add(setup.fzone, C.LOCATION_SZONE, 5, C.POS_FACEUP);
		}
		for (const [index, code] of (setup.hand ?? []).entries()) {
			add(code, C.LOCATION_HAND, index, C.POS_FACEDOWN);
		}
		for (const [index, code] of (setup.grave ?? []).entries()) {
			add(code, C.LOCATION_GRAVE, index, C.POS_FACEUP);
		}
		const deck = [...(setup.deck ?? [])];
		while (deck.length < 40) {
			deck.push(DEFAULT_DECK_FILLER);
		}
		for (const [index, code] of deck.entries()) {
			add(code, C.LOCATION_DECK, index, C.POS_FACEDOWN_DEFENSE);
		}
		for (const [index, code] of (setup.extra ?? []).entries()) {
			add(code, C.LOCATION_EXTRA, index, C.POS_FACEDOWN_DEFENSE);
		}
	}

	start(): void {
		this.duel.startDuel(
			calculateDuelOptions({
				lflist: 0,
				rule: 0,
				mode: 1,
				duel_rule: 2,
				no_check_deck: 0,
				no_shuffle_deck: 0,
				start_lp: 8000,
				start_hand: 5,
				draw_count: 1,
				time_limit: 450,
			}),
		);
	}

	endDuel(): void {
		this.duel.endDuel();
	}

	queryCard(player: number, location: number, sequence: number) {
		return this.duel.queryCard({ player, location, sequence, queryFlag: 0xffffffff });
	}

	queryFieldCount(player: number, location: number): number {
		return this.duel.queryFieldCount({ player, location });
	}

	queryFieldCards(player: number, location: number) {
		return this.duel.queryFieldCard({ player, location, queryFlag: 0xffffffff });
	}

	// ------------------------------------------------------------------
	// response policy hooks (tests override these)
	// ------------------------------------------------------------------

	/** indices into msg.cards, or [] to cancel (only valid when cancelable) */
	selectCardIndices(msg: YGOProMsgSelectCard): number[] {
		const index = this.selectCardIndex(msg);
		return index === -1 ? [] : [index];
	}

	/** index into msg.cards, or -1 to cancel (only valid when cancelable) */
	selectCardIndex(_msg: YGOProMsgSelectCard): number {
		return 0;
	}

	/** how many cards to pick in a select-unselect prompt before finishing */
	selectUnselectTargetCount(_msg: YGOProMsgSelectUnselectCard): number {
		return 1;
	}

	answerEffectYn(_msg: YGOProMsgSelectEffectYn): boolean {
		return true;
	}

	answerYesNo(_msg: YGOProMsgSelectYesNo): boolean {
		return true;
	}

	/** return a chain entry to activate or null to pass */
	selectChainIndex(_msg: YGOProMsgSelectChain): number | null {
		return null;
	}

	/** idle command response; default ends the phase */
	idleAction(msg: YGOProMsgSelectIdleCmd): Uint8Array {
		return msg.prepareResponse(IdleCmdType.TO_EP);
	}

	/** battle command response; default ends the battle phase */
	battleAction(msg: YGOProMsgSelectBattleCmd): Uint8Array {
		return msg.prepareResponse(BattleCmdType.TO_EP);
	}

	// ------------------------------------------------------------------
	// driving
	// ------------------------------------------------------------------

	/**
	 * Process messages until `until` matches a message that does not
	 * require a response. Response messages are answered through the
	 * policy hooks. Returns the messages processed.
	 */
	runUntil(until: (msg: YGOProMsgBase, seen: YGOProMsgBase[]) => boolean): YGOProMsgBase[] {
		const collected: YGOProMsgBase[] = [];
		let iterations = 0;
		for (;;) {
			const result = this.duel.process();
			for (const msg of result.messages ?? []) {
				collected.push(msg);
				this.seen.push(msg);
				this.track(msg);
				if (msg instanceof YGOProMsgRetry) {
					// the core asks for the previous response again
					if (this.lastResponse !== null) {
						this.duel.setResponse(this.lastResponse);
					}
					continue;
				}
				if (!(msg instanceof YGOProMsgResponseBase)) {
					if (until(msg, this.seen)) {
						return collected;
					}
					continue;
				}
				const response = this.respond(msg);
				if (response === null) {
					return collected;
				}
				this.lastResponse = response;
				this.lastMsgWasUnselect = msg instanceof YGOProMsgSelectUnselectCard;
				this.duel.setResponse(response);
			}
			if (result.status === 2) {
				return collected;
			}
			if (result.length === 0 && ++this.emptyResults > 10) {
				return collected;
			}
			if (result.length > 0) {
				this.emptyResults = 0;
			}
			if (iterations++ > 4000) {
				const tail = this.seen
					.slice(-25)
					.map((m) => m.constructor.name)
					.join(",");
				const dump = this.seen
					.slice(0, 60)
					.map((m) => m.constructor.name)
					.join(",");
				throw new Error(
					`runUntil: duel did not settle within 4000 process calls; head=${dump}; tail=${tail}`,
				);
			}
		}
	}

	private track(msg: YGOProMsgBase): void {
		if (msg instanceof YGOProMsgNewTurn) {
			this.turn++;
			this.turnPlayer = msg.player;
		} else if (msg instanceof YGOProMsgNewPhase) {
			this.phase = msg.phase;
		}
	}

	private respondUnselect(msg: YGOProMsgSelectUnselectCard): Uint8Array {
		if (!this.lastMsgWasUnselect) {
			this.unselectPicks = 0;
		}
		this.lastMsgWasUnselect = true;
		if (
			this.unselectPicks >= msg.max ||
			this.unselectPicks >= this.selectUnselectTargetCount(msg)
		) {
			return msg.prepareResponse(null);
		}
		this.unselectPicks++;
		return msg.prepareResponse(IndexResponse(0));
	}

	private respond(msg: YGOProMsgResponseBase): Uint8Array | null {
		if (msg instanceof YGOProMsgSelectIdleCmd) {
			return this.idleAction(msg);
		}
		if (msg instanceof YGOProMsgSelectBattleCmd) {
			return this.battleAction(msg);
		}
		if (msg instanceof YGOProMsgSelectCard) {
			const indices = [...this.selectCardIndices(msg)];
			if (indices.length === 0) {
				return msg.prepareResponse(null);
			}
			// pad with the first entries when the policy picked fewer than the minimum
			for (let index = 0; indices.length < msg.min && index < msg.cards.length; index++) {
				if (!indices.includes(index)) {
					indices.push(index);
				}
			}
			return msg.prepareResponse(indices.map((index) => IndexResponse(index)));
		}
		if (msg instanceof YGOProMsgSelectTribute) {
			return msg.prepareResponse([IndexResponse(0)]);
		}
		if (msg instanceof YGOProMsgSelectEffectYn) {
			return msg.prepareResponse(this.answerEffectYn(msg));
		}
		if (msg instanceof YGOProMsgSelectYesNo) {
			return msg.prepareResponse(this.answerYesNo(msg));
		}
		if (msg instanceof YGOProMsgSelectChain) {
			const index = this.selectChainIndex(msg);
			if (index === null) {
				return msg.prepareResponse(null);
			}
			return msg.prepareResponse(IndexResponse(index));
		}
		if (msg instanceof YGOProMsgSelectPosition) {
			return msg.prepareResponse(1);
		}
		if (msg instanceof YGOProMsgSelectPlace) {
			const places = msg.getSelectablePlaces();
			return places.length > 0 ? msg.prepareResponse([places[0]]) : msg.prepareResponse([]);
		}
		if (msg instanceof YGOProMsgSelectDisField) {
			const places = msg.getSelectablePlaces();
			return places.length > 0 ? msg.prepareResponse([places[0]]) : msg.prepareResponse([]);
		}
		if (msg instanceof YGOProMsgSelectOption) {
			return msg.prepareResponse(IndexResponse(0));
		}
		if (msg instanceof YGOProMsgSelectSum) {
			return msg.prepareResponse([IndexResponse(0)]);
		}
		if (msg instanceof YGOProMsgSelectCounter) {
			return msg.prepareResponse([]);
		}
		if (msg instanceof YGOProMsgSelectUnselectCard) {
			return this.respondUnselect(msg);
		}
		return null;
	}
}
