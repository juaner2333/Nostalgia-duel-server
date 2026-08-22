import type { CardReaderFn } from "koishipro-core.js";
import { YGOProLFList } from "ygopro-lflist-encode";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runInWorker } from "yuzuthread";
import BetterLock from "better-lock";
import { config } from "src/config";
import { Logger } from "src/shared/logger/domain/Logger";
import LoggerFactory from "src/shared/logger/infrastructure/LoggerFactory";
import { CardStorage } from "./card-storage";
import { CardLoadWorker } from "./card-load-worker";
import {
	resolveFormatPath,
	resolveFormatPreloadScriptPaths,
	resolvePools,
} from "./ResourcePoolResolver";

let sharedInstance: YGOProResourceLoader | null = null;

export class YGOProResourceLoader {
	private readonly logger: Logger;
	private readonly loadingLock = new BetterLock();
	private readonly resolvedPools = resolvePools({
		resourcesDir: config.resources.dir,
		logger: LoggerFactory.getLogger(),
	});
	private baseLoadingPromise?: Promise<CardStorage>;
	private baseCardStorage?: CardStorage;
	private baseSha512?: Buffer;
	private readonly formatCardStorages = new Map<string, CardStorage>();
	private readonly formatCardStoragePromises = new Map<string, Promise<CardStorage>>();
	private readonly formatBanListHashes = new Map<string, number>();

	constructor() {
		this.logger = LoggerFactory.getLogger();
	}

	static getShared(): YGOProResourceLoader {
		if (!sharedInstance) {
			throw new Error("YGOProResourceLoader not initialized. Call initShared() in index.ts first.");
		}
		return sharedInstance;
	}

	static async start(): Promise<void> {
		await YGOProResourceLoader.get().loadBaseCdb();
	}

	static get(): YGOProResourceLoader {
		if (!sharedInstance) {
			sharedInstance = new YGOProResourceLoader();
		}
		return sharedInstance;
	}

	static get isInitialized(): boolean {
		return sharedInstance !== null;
	}

	get baseSha512Hex(): string | null {
		return this.baseSha512?.toString("hex") ?? null;
	}

	async getFormatCardStorage(formatId: string): Promise<CardStorage> {
		const existing = this.formatCardStorages.get(formatId);
		if (existing) {
			return existing;
		}
		const loading = this.formatCardStoragePromises.get(formatId);
		if (loading) {
			return loading;
		}
		const promise = this.loadFormatCardStorage(formatId);
		this.formatCardStoragePromises.set(formatId, promise);
		try {
			return await promise;
		} finally {
			if (this.formatCardStoragePromises.get(formatId) === promise) {
				this.formatCardStoragePromises.delete(formatId);
			}
		}
	}

	async getFormatCardReader(formatId: string): Promise<CardReaderFn> {
		return (await this.getFormatCardStorage(formatId)).toCardReader();
	}

	getFormatScriptPaths(formatId: string): string[] {
		return [resolveFormatPath(this.resolvedPools, formatId), this.basePath()];
	}

	/**
	 * Script name of the format-level `script/special.lua` preload patch when it
	 * exists, otherwise an empty list (no preload, current behavior unchanged).
	 * The returned name is relative so the koishipro script reader resolves it
	 * against the format script dir.
	 */
	getFormatPreloadScriptPaths(formatId: string): string[] {
		return resolveFormatPreloadScriptPaths(resolveFormatPath(this.resolvedPools, formatId));
	}

	async getFormatBanListHash(formatId: string): Promise<number> {
		const existing = this.formatBanListHashes.get(formatId);
		if (existing !== undefined) {
			return existing;
		}
		const text = await readFile(
			path.join(resolveFormatPath(this.resolvedPools, formatId), "lflist.conf"),
			"utf-8",
		);
		const item = new YGOProLFList().fromText(text).items[0];
		if (!item) {
			throw new Error(`Format ${formatId} has no LFList`);
		}
		const hash = item.getHash();
		this.formatBanListHashes.set(formatId, hash);
		return hash;
	}

	async getOcgcoreWasmBinary(): Promise<Buffer | undefined> {
		return (await this.loadBaseCdb()).ocgcoreWasmBinary;
	}

	async *getLFLists(): AsyncGenerator<{ item: YGOProLFList["items"][number]; text: string }> {
		for (const formatId of Object.keys(this.resolvedPools.formats).sort()) {
			const text = await readFile(
				path.join(resolveFormatPath(this.resolvedPools, formatId), "lflist.conf"),
				"utf-8",
			);
			for (const item of new YGOProLFList().fromText(text).items) {
				yield { item, text };
			}
		}
	}

	async logLFLists(): Promise<void> {
		this.logger.info("Loading Forbidden/Limited Lists...");
		let index = 0;
		for await (const { item: lflist } of this.getLFLists()) {
			this.logger.info(`  [${index}] ${lflist.name || "Unnamed"} ${lflist.getHash()}`);
			index++;
		}
		if (index === 0) {
			this.logger.error("No fixed nostalgia lflist.conf found");
			return;
		}
		this.logger.info(`Total LFLists loaded: ${index}`);
	}

	private basePath(): string {
		return this.resolvedPools.base;
	}

	private async loadBaseCdb(): Promise<CardStorage> {
		if (this.baseCardStorage) {
			return this.baseCardStorage;
		}
		if (this.baseLoadingPromise) {
			return this.baseLoadingPromise;
		}
		const loading = this.loadingLock.acquire(async () => {
			const { cardStorage, sha512 } = await this.loadCardStorageFromPaths(
				[this.basePath()],
				"base",
			);
			this.baseCardStorage = cardStorage;
			this.baseSha512 = sha512;
			return cardStorage;
		});
		this.baseLoadingPromise = loading;
		try {
			return await loading;
		} finally {
			if (this.baseLoadingPromise === loading) {
				this.baseLoadingPromise = undefined;
			}
		}
	}

	private async loadFormatCardStorage(formatId: string): Promise<CardStorage> {
		const formatPath = resolveFormatPath(this.resolvedPools, formatId);
		const cardIds = await readWhitelistCardIds(path.join(formatPath, "lflist.conf"));
		const storage = (await this.loadBaseCdb()).filterForFormat(cardIds);
		for (const cardId of cardIds) {
			if (!storage.readCard(cardId)) {
				throw new Error(`Format ${formatId} whitelist references cards outside base/cards.cdb`);
			}
		}
		this.formatCardStorages.set(formatId, storage);
		return storage;
	}

	private async loadCardStorageFromPaths(paths: string[], label: string) {
		const { cardStorage, dbCount, failedFiles, sha512 } = await runInWorker(
			CardLoadWorker,
			(worker) => worker.load(),
			paths,
			undefined,
		);

		for (const failedFile of failedFiles) {
			this.logger.error(`Failed to read ${failedFile}`);
		}
		this.logger.info(
			`Loaded ${label} database from ${dbCount} database with ${cardStorage.size} cards`,
		);
		return { cardStorage, sha512 };
	}
}

export async function readWhitelistCardIds(lflistPath: string): Promise<Set<number>> {
	const lines = (await readFile(lflistPath, "utf-8")).split(/\r?\n/);
	const whitelistIndex = lines.findIndex((line) => line.trim() === "$whitelist");
	if (whitelistIndex === -1) {
		throw new Error(`Whitelist marker missing: ${lflistPath}`);
	}

	const cardIds = new Set<number>();
	for (const rawLine of lines.slice(whitelistIndex + 1)) {
		const match = /^(\d+)\s+([0-3])(?:\s|$)/.exec(rawLine.trim());
		if (!match) {
			continue;
		}
		const cardId = Number(match[1]);
		if (!Number.isInteger(cardId) || cardId < 1 || cardId > 0x7fffffff || cardIds.has(cardId)) {
			throw new Error(`Invalid whitelist card ID in ${lflistPath}: ${match[1]}`);
		}
		cardIds.add(cardId);
	}
	if (cardIds.size === 0) {
		throw new Error(`Whitelist has no cards: ${lflistPath}`);
	}
	return cardIds;
}
