import fs from "node:fs";
import path from "node:path";
import type { Logger } from "src/shared/logger/domain/Logger";

interface Manifest {
	runtime?: {
		ygopro?: {
			base?: unknown;
			formats?: unknown;
		};
	};
}

export interface ResourcePoolResolverOptions {
	manifestPath: string;
	resourcesDir: string;
	logger: Logger;
}

export interface ResolvedPools {
	base: string | null;
	formats: Record<string, string>;
}

/** Resolves the only supported runtime layout: one fixed base and named formats. */
export function resolvePools(options: ResourcePoolResolverOptions): ResolvedPools {
	const manifest = readManifest(options.manifestPath, options.logger);
	if (!manifest) {
		return { base: null, formats: {} };
	}

	const runtime = manifest.runtime?.ygopro;
	if (typeof runtime?.base !== "string" || runtime.base.length === 0) {
		options.logger.error(
			`ResourcePoolResolver: manifest at "${options.manifestPath}" has no runtime.ygopro.base`,
		);
		return { base: null, formats: {} };
	}
	const base = path.join(path.resolve(options.resourcesDir), "ygopro", runtime.base);
	if (
		typeof runtime.formats !== "object" ||
		runtime.formats === null ||
		Array.isArray(runtime.formats)
	) {
		options.logger.error(
			`ResourcePoolResolver: manifest at "${options.manifestPath}" has no runtime.ygopro.formats`,
		);
		return { base, formats: {} };
	}

	const formats = Object.fromEntries(
		Object.entries(runtime.formats)
			.filter(([, resourcePath]) => typeof resourcePath === "string" && resourcePath.length > 0)
			.map(([formatId, resourcePath]) => [
				formatId,
				path.join(path.resolve(options.resourcesDir), "ygopro", resourcePath),
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

function readManifest(manifestPath: string, logger: Logger): Manifest | null {
	try {
		return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Manifest;
	} catch (error) {
		logger.error(
			`ResourcePoolResolver: failed to read or parse manifest at "${manifestPath}": ${String(error)}`,
		);
		return null;
	}
}

function warnMissingDirectories(paths: string[], logger: Logger): void {
	for (const resourcePath of paths) {
		if (!fs.existsSync(resourcePath) || !fs.statSync(resourcePath).isDirectory()) {
			logger.warn(`ResourcePoolResolver: resource directory does not exist: ${resourcePath}`);
		}
	}
}
