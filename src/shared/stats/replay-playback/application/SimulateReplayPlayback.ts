import { DirScriptReaderEx, type OcgcoreDuel, type OcgcoreWrapper } from "koishipro-core.js";
import { YGOProYrp } from "ygopro-yrp-encode";
import {
	OcgcoreScriptConstants as C,
	YGOProMsgResponseBase,
	YGOProMsgRetry,
	type YGOProMsgBase,
} from "ygopro-msg-encode";

import { createDuelCoreWrapper } from "@ygopro/ocgcore-worker/duel-core";
import { YGOProCardSearchRepository } from "@ygopro/card/infrastructure/YGOProCardSearchRepository";
import type { NostalgiaFormatId } from "@ygopro/room/domain/NostalgiaFormat";
import { YGOProResourceLoader } from "@ygopro/ygopro/YGOProResourceLoader";
import {
	resolveFormatPath,
	resolveFormatPreloadScriptPaths,
	resolvePools,
} from "@ygopro/ygopro/ResourcePoolResolver";
import LoggerFactory from "src/shared/logger/infrastructure/LoggerFactory";
import { config } from "src/config";

export type PlaybackMessage = { msgType: string } & Record<string, unknown>;

export interface ReplayPlaybackResult {
	playerNames: string[];
	startLp: number;
	startHand: number;
	drawCount: number;
	messages: PlaybackMessage[];
	cardNames: Record<string, string>;
	/**
	 * True when the recorded response stream ends before the duel does
	 * (e.g. the live duel was cut short by a disconnect/timeout, so no
	 * MSG_WIN was ever recorded). The partial stream is still returned.
	 */
	truncated: boolean;
}

export class ReplayPlaybackError extends Error {
	constructor(
		message: string,
		readonly clientMessage: string,
	) {
		super(message);
	}
}

interface FormatCore {
	wrapper: OcgcoreWrapper;
	preloadScriptPaths: string[];
}

const formatCoreCache = new Map<string, Promise<FormatCore>>();

async function createFormatCore(formatId: string): Promise<FormatCore> {
	const logger = LoggerFactory.getLogger();
	const pools = resolvePools({
		resourcesDir: config.resources.dir,
		profile: config.resources.profile,
		logger,
	});
	const formatPath = resolveFormatPath(pools, formatId);
	const wrapper = await createDuelCoreWrapper(formatId as NostalgiaFormatId);
	wrapper.setScriptReader(await DirScriptReaderEx(formatPath, pools.base));
	const storage = await YGOProResourceLoader.get().getFormatCardStorage(formatId);
	wrapper.setCardReader(storage.toCardReader());
	return { wrapper, preloadScriptPaths: resolveFormatPreloadScriptPaths(formatPath) };
}

function getFormatCore(formatId: string): Promise<FormatCore> {
	let cached = formatCoreCache.get(formatId);
	if (!cached) {
		cached = createFormatCore(formatId);
		cached.catch(() => formatCoreCache.delete(formatId));
		formatCoreCache.set(formatId, cached);
	}
	return cached;
}

/**
 * Mirrors the ygopro client replay loader: the stored deck arrays are already
 * reversed by DuelRecord.toReplayDeck, so they are inserted FORWARD at
 * sequence 0 (each insert pushes existing cards down). This reproduces the
 * live deck order exactly — verified against real server recordings: a
 * backward iteration diverges from the recorded response stream within a few
 * prompts (the engine rejects misaligned responses with MSG_RETRY).
 */
function loadDeck(duel: OcgcoreDuel, deck: { main: number[]; extra: number[] }, player: number) {
	for (let i = 0; i < deck.main.length; i++) {
		duel.newCard({
			code: deck.main[i]!,
			owner: player,
			player,
			location: C.LOCATION_DECK,
			sequence: 0,
			position: C.POS_FACEDOWN_DEFENSE,
		});
	}
	for (let i = 0; i < deck.extra.length; i++) {
		duel.newCard({
			code: deck.extra[i]!,
			owner: player,
			player,
			location: C.LOCATION_EXTRA,
			sequence: 0,
			position: C.POS_FACEDOWN_DEFENSE,
		});
	}
}

const MAX_PROCESS_CALLS = 20000;
const MAX_EMPTY_RESULTS = 50;

/**
 * Drives the WASM core through the recorded duel exactly like a replaying
 * client: engine messages are collected, response prompts are answered from
 * the recorded response stream, MSG_RETRY re-feeds the previous response.
 *
 * Returns the emitted messages plus a `truncated` flag: when the recorded
 * responses run out mid-duel (the live duel ended abnormally and no further
 * responses were ever recorded) the partial stream is returned as-is instead
 * of failing, so the player page can show everything that was recorded.
 */
function driveDuel(
	duel: OcgcoreDuel,
	responses: Uint8Array[],
): { messages: YGOProMsgBase[]; truncated: boolean } {
	const messages: YGOProMsgBase[] = [];
	let responseIndex = 0;
	let lastResponse: Uint8Array | null = null;
	let emptyResults = 0;
	let truncated = false;

	for (let iteration = 0; iteration < MAX_PROCESS_CALLS; iteration++) {
		const result = duel.process();
		let outOfResponses = false;
		for (const msg of result.messages ?? []) {
			if (msg instanceof YGOProMsgRetry) {
				if (lastResponse !== null) {
					duel.setResponse(lastResponse);
				}
				continue;
			}
			if (msg instanceof YGOProMsgResponseBase) {
				const response = responses[responseIndex++];
				if (!response) {
					outOfResponses = true;
					truncated = true;
					break;
				}
				lastResponse = response;
				duel.setResponse(response);
				continue;
			}
			messages.push(msg);
		}
		if (outOfResponses) {
			break;
		}
		if (result.status === 2) {
			break;
		}
		if (result.length === 0) {
			if (++emptyResults > MAX_EMPTY_RESULTS) {
				truncated = true;
				break;
			}
		} else {
			emptyResults = 0;
		}
	}
	return { messages, truncated };
}

function toJsonSafe(value: unknown): unknown {
	if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
		return Array.from(value as Uint8Array);
	}
	if (typeof value === "bigint") {
		return Number(value);
	}
	if (Array.isArray(value)) {
		return value.map(toJsonSafe);
	}
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			out[key] = toJsonSafe(entry);
		}
		return out;
	}
	return value;
}

function serializeMessages(messages: YGOProMsgBase[]): PlaybackMessage[] {
	return messages.map((msg) => {
		const plain = toJsonSafe(msg) as Record<string, unknown>;
		// discriminator key must not collide with data fields like Win.type / Hint.type
		return { msgType: msg.constructor.name, ...plain };
	});
}

const MAX_TRACKED_CODES = 4096;

function collectCardCodes(payload: unknown, into: Set<number>): void {
	if (into.size >= MAX_TRACKED_CODES || payload === null || typeof payload !== "object") {
		return;
	}
	if (Array.isArray(payload)) {
		for (const item of payload) {
			collectCardCodes(item, into);
		}
		return;
	}
	for (const [key, value] of Object.entries(payload)) {
		if (
			(key === "code" || key === "code1" || key === "code2" || key === "alias") &&
			typeof value === "number" &&
			Number.isInteger(value) &&
			value > 0 &&
			value <= 0x7fffffff
		) {
			into.add(value >>> 0);
		} else {
			collectCardCodes(value, into);
		}
	}
}

export async function simulateReplayPlayback(
	formatId: string,
	replayData: Buffer,
): Promise<ReplayPlaybackResult> {
	let yrp: YGOProYrp;
	try {
		yrp = new YGOProYrp().fromYrp(new Uint8Array(replayData));
	} catch (error) {
		throw new ReplayPlaybackError(
			`Failed to parse replay data: ${error instanceof Error ? error.message : String(error)}`,
			"录像文件无法解析。",
		);
	}

	if (!yrp.header || !yrp.hostDeck || !yrp.clientDeck) {
		throw new ReplayPlaybackError("Replay is missing header or decks", "录像数据不完整。");
	}
	if (yrp.isTag) {
		throw new ReplayPlaybackError("Tag replays are not supported", "暂不支持双人（TAG）录像回放。");
	}

	const { wrapper, preloadScriptPaths } = await getFormatCore(formatId);
	const duel = wrapper.createDuelV2(yrp.header.seedSequence);

	try {
		duel.setPlayerInfo({
			player: 0,
			lp: yrp.startLp,
			startHand: yrp.startHand,
			drawCount: yrp.drawCount,
		});
		duel.setPlayerInfo({
			player: 1,
			lp: yrp.startLp,
			startHand: yrp.startHand,
			drawCount: yrp.drawCount,
		});
		for (const scriptPath of preloadScriptPaths) {
			duel.preloadScript(scriptPath);
		}
		loadDeck(duel, yrp.hostDeck, 0);
		loadDeck(duel, yrp.clientDeck, 1);
		duel.startDuel(yrp.opt);

		const { messages, truncated } = driveDuel(duel, yrp.responses);
		const serialized = serializeMessages(messages);

		// The engine never emits MSG_START — in live play the server builds it
		// itself. Prepend an observer-view equivalent so the player page can
		// initialize LP and zone counts from the stream like a real client.
		serialized.unshift({
			msgType: "YGOProMsgStart",
			playerType: 0x10,
			duelRule: 0,
			startLp0: yrp.startLp,
			startLp1: yrp.startLp,
			player0: {
				deckCount: yrp.hostDeck.main.length,
				extraCount: yrp.hostDeck.extra.length,
			},
			player1: {
				deckCount: yrp.clientDeck.main.length,
				extraCount: yrp.clientDeck.extra.length,
			},
		});

		const codes = new Set<number>();
		for (const deck of [yrp.hostDeck, yrp.clientDeck]) {
			for (const code of [...deck.main, ...deck.extra]) {
				codes.add(code >>> 0);
			}
		}
		for (const message of serialized) {
			collectCardCodes(message, codes);
		}

		const cardNames: Record<string, string> = {};
		const names = await new YGOProCardSearchRepository().resolveNames([...codes]);
		for (const [code, name] of names) {
			cardNames[String(code)] = name;
		}

		return {
			playerNames: [yrp.hostName, yrp.clientName],
			startLp: yrp.startLp,
			startHand: yrp.startHand,
			drawCount: yrp.drawCount,
			messages: serialized,
			cardNames,
			truncated,
		};
	} finally {
		try {
			duel.endDuel();
		} catch {
			// duel already ended or core disposed; nothing to clean up
		}
	}
}
