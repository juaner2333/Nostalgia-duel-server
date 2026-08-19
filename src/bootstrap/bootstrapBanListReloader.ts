// Periodic ban-list hot-reload.
//
// Ban lists are loaded once at boot (bootstrapYgoproResources).
// The resources sidecar refreshes the underlying .conf files on disk, but the Node
// process never re-reads them — so a new ban list historically required a full restart.
// This reloader closes that gap: on an interval it detects on-disk changes via a
// size+mtime fingerprint and, when something changed, rebuilds the ban-list array
// into a local temporary and atomically swaps it into the live repository.
//
// Safety properties:
// - Atomic swap (replaceAll): the swap is synchronous, so no concurrent HTTP read can
//   observe an empty or half-updated list.
// - In-flight rooms are unaffected: they snapshot their ban list at construction
//   (YGOProRoom), not a live repository reference.
// - Never swaps in an empty parse result: if a rebuild yields zero lists the previous
//   in-memory lists are kept and the change is retried next cycle.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { Logger } from "@shared/logger/domain/Logger";
import { YGOProBanList } from "@ygopro/ban-list/domain/YGOProBanList";
import YGOProBanListMemoryRepository from "@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository";
import { config } from "src/config";

import { loadYgoproBanLists } from "./bootstrapBanListLoaders";

const DEFAULT_INTERVAL_MS = (Number(process.env.RESOURCES_REFRESH_SECONDS) || 600) * 1000;

// Timestamp of when the in-memory ban lists were last (re)loaded. Set at reloader
// start (lists are current as of boot) and updated on every successful reload.
// Exposed via getBanListReloadedAt() for a future resource-version endpoint.
let reloadedAt: string | null = null;

export function getBanListReloadedAt(): string | null {
	return reloadedAt;
}

/** Injectable seam so the reload logic can be tested without the filesystem or timers. */
export interface BanListReloaderPorts {
	loadYgopro(): Promise<YGOProBanList[]>;
	replaceYgopro(next: YGOProBanList[]): void;
	fingerprint(): Promise<string>;
	now(): string;
}

export interface ReloadOutcome {
	changed: boolean;
	fingerprint: string;
}

/**
 * Runs a single reload cycle. Pure with respect to timers — the scheduler calls this.
 * Skips the rebuild when the fingerprint is unchanged; keeps the previous lists when a
 * rebuild yields an empty result (returns the OLD fingerprint so the next cycle retries).
 */
export async function reloadBanListsOnce(
	ports: BanListReloaderPorts,
	logger: Logger,
	lastFingerprint: string,
): Promise<ReloadOutcome> {
	const fingerprint = await ports.fingerprint();
	if (fingerprint === lastFingerprint) {
		return { changed: false, fingerprint };
	}

	const ygoproNext = await ports.loadYgopro();

	if (ygoproNext.length === 0) {
		logger.error(
			`[banlist-reloader] rebuild produced empty ban lists (ygopro=${ygoproNext.length}) — keeping previous lists`,
		);
		// Do not adopt the new fingerprint: retry on the next cycle.
		return { changed: false, fingerprint: lastFingerprint };
	}

	// Atomic swap into the live repository.
	ports.replaceYgopro(ygoproNext);
	reloadedAt = ports.now();

	logger.info(`[banlist-reloader] reloaded ${ygoproNext.length} ygopro ban lists`);
	return { changed: true, fingerprint };
}

export interface BanListReloaderOptions {
	intervalMs?: number;
	ports?: BanListReloaderPorts;
}

export interface BanListReloaderHandle {
	stop(): void;
}

/**
 * Starts the periodic ban-list reloader. Captures the current on-disk fingerprint as the
 * baseline (boot already loaded the lists) and only reloads when it changes thereafter.
 * Returns a handle whose stop() clears the timer — the clean rollback boundary.
 */
export async function bootstrapBanListReloader(
	logger: Logger,
	options: BanListReloaderOptions = {},
): Promise<BanListReloaderHandle> {
	const ports = options.ports ?? createDefaultPorts();
	const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

	let lastFingerprint = await ports.fingerprint().catch(() => "");
	reloadedAt = ports.now();
	let running = false;

	const tick = async (): Promise<void> => {
		if (running) {
			return; // overlap guard: never run two reloads concurrently
		}
		running = true;
		try {
			const outcome = await reloadBanListsOnce(ports, logger, lastFingerprint);
			lastFingerprint = outcome.fingerprint;
		} catch (error) {
			logger.error("[banlist-reloader] reload cycle failed — keeping previous lists");
			logger.error(error);
		} finally {
			running = false;
		}
	};

	const timer = setInterval(() => void tick(), intervalMs);
	timer.unref();

	logger.info(`🕒 Ban-list reloader started (every ${Math.round(intervalMs / 1000)}s)`);
	return { stop: (): void => clearInterval(timer) };
}

function createDefaultPorts(): BanListReloaderPorts {
	return {
		loadYgopro: loadYgoproBanLists,
		replaceYgopro: (next) => YGOProBanListMemoryRepository.replaceAll(next),
		fingerprint: () => fingerprintLflists(config.resources.dir),
		now: () => new Date().toISOString(),
	};
}

/**
 * Fingerprint every lflist .conf under the resource directories that feed the ygopro
 * loader, using size + mtime (never reads/hashes contents on the event loop). Missing
 * directories are skipped, not fatal.
 */
async function fingerprintLflists(baseDir: string): Promise<string> {
	const roots = [join(baseDir, "ygopro", "base"), join(baseDir, "ygopro", "formats")];
	const parts: string[] = [];
	for (const root of roots) {
		await collectConfFingerprints(root, parts);
	}
	parts.sort();
	return parts.join("|");
}

async function collectConfFingerprints(dir: string, out: string[]): Promise<void> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return; // directory absent — skip
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			await collectConfFingerprints(full, out);
		} else if (entry.name.endsWith(".conf")) {
			try {
				const { size, mtimeMs } = await stat(full);
				out.push(`${full}:${size}:${mtimeMs}`);
			} catch {
				// file vanished between readdir and stat — skip it
			}
		}
	}
}
