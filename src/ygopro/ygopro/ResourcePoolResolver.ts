import fs from "node:fs";
import path from "node:path";
import { NOSTALGIA_FORMAT_IDS } from "@ygopro/room/domain/NostalgiaFormat";
import type { Logger } from "src/shared/logger/domain/Logger";

export interface ResourcePoolResolverOptions {
	resourcesDir: string;
	logger: Logger;
}

export interface ResolvedPools {
	base: string;
	formats: Record<string, string>;
}

/**
 * Resolves the only supported runtime layout: the fixed base tree plus the
 * 1103/1109 formats registered in the domain layer. No manifest is read; the
 * resource root is the bundled `nostalgia-resources/` directory itself.
 */
export function resolvePools(options: ResourcePoolResolverOptions): ResolvedPools {
	const root = path.resolve(options.resourcesDir);
	const base = path.join(root, "ygopro", "base");
	const formats = Object.fromEntries(
		NOSTALGIA_FORMAT_IDS.map((formatId) => [
			formatId,
			path.join(root, "ygopro", "formats", formatId),
		]),
	);
	warnMissingDirectories([base, ...Object.values(formats)], options.logger);
	return { base, formats };
}

export function resolveFormatPath(resolved: ResolvedPools, formatId: string): string {
	const formatPath = resolved.formats[formatId];
	if (!formatPath) {
		throw new Error(`Unknown YGOPro format: ${formatId}`);
	}
	return formatPath;
}

/**
 * Script name of the format-level `script/special.lua` preload patch that the
 * koishipro DirScriptReaderEx resolves against each script dir (`script/` is
 * its first candidate, so the format dir wins), or an empty list when the
 * patch is absent (no preload, current behavior unchanged).
 *
 * Absolute paths must NOT be used: DirScriptReaderEx strips the leading `/`
 * and re-joins it below the base dirs, so an absolute path can never resolve
 * and the preload silently no-ops.
 */
export function resolveFormatPreloadScriptPaths(formatPath: string): string[] {
	return fs.existsSync(path.join(formatPath, "script", "special.lua"))
		? ["script/special.lua"]
		: [];
}

function warnMissingDirectories(paths: string[], logger: Logger): void {
	for (const resourcePath of paths) {
		if (!fs.existsSync(resourcePath) || !fs.statSync(resourcePath).isDirectory()) {
			logger.warn(`ResourcePoolResolver: resource directory does not exist: ${resourcePath}`);
		}
	}
}
