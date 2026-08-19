/**
 * Architecture guard for the remove-edopro-support change (tasks 2.7 → 8.1).
 *
 * Rule 1: production code outside src/edopro must not import EDOPro.
 * Rule 2: production code in src/shared must not import any client module
 *         (src/edopro or src/ygopro).
 *
 * All known couplings have been eliminated and src/edopro deleted (task 7.1),
 * so KNOWN_COUPLINGS is empty: the suite fails on any new coupling in either
 * direction.
 *
 * Production code follows tsconfig.json: every .ts file under src/ except
 * *.test.ts files and the src/test-support directory.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, posix, relative, resolve } from "path";

const SRC_ROOT = __dirname;
const PROJECT_ROOT = join(SRC_ROOT, "..");
const TEST_SUPPORT_ROOT = join(SRC_ROOT, "test-support");
const EDOPRO_DIR = posix.join("src", "edopro");
const YGOPRO_DIR = posix.join("src", "ygopro");
const SHARED_DIR = posix.join("src", "shared");

const ALIAS_TO_SRC_DIR: Record<string, string> = {
	"@edopro/": EDOPRO_DIR,
	"@ygopro/": YGOPRO_DIR,
	"@shared/": SHARED_DIR,
	"@test-support/": posix.join("src", "test-support"),
};

/**
 * Couplings explicitly allowed until the phase that removes them lands.
 * Format: "<file> -> <imported module>", both relative to the repo root.
 */
const KNOWN_COUPLINGS: readonly string[] = [];

const isProductionFile = (absolutePath: string): boolean =>
	absolutePath.endsWith(".ts") && !absolutePath.endsWith(".test.ts");

const walk = (dir: string): string[] => {
	const entries = readdirSync(dir);
	const files: string[] = [];
	for (const entry of entries) {
		const absolute = join(dir, entry);
		if (statSync(absolute).isDirectory()) {
			if (absolute === TEST_SUPPORT_ROOT) {
				continue;
			}
			files.push(...walk(absolute));
			continue;
		}
		if (isProductionFile(absolute)) {
			files.push(absolute);
		}
	}

	return files;
};

const stripComments = (content: string): string =>
	content
		.split("\n")
		.filter((line) => {
			const trimmed = line.trim();

			return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
		})
		.join("\n");

const importSpecifiers = (content: string): string[] => {
	const withoutComments = stripComments(content);
	const specifiers: string[] = [];
	const fromImports = withoutComments.matchAll(/from\s+["']([^"']+)["']/g);
	for (const match of fromImports) {
		specifiers.push(match[1]);
	}
	const sideEffectImports = withoutComments.matchAll(/\bimport\s+["']([^"']+)["']/g);
	for (const match of sideEffectImports) {
		specifiers.push(match[1]);
	}

	return specifiers;
};

const toPosix = (path: string): string => path.split(/[\\/]/).join("/");

const resolveToSrcPath = (fromFile: string, specifier: string): string | null => {
	for (const [alias, srcDir] of Object.entries(ALIAS_TO_SRC_DIR)) {
		if (specifier.startsWith(alias)) {
			return posix.join(srcDir, specifier.slice(alias.length));
		}
	}
	if (specifier.startsWith(".")) {
		return toPosix(relative(PROJECT_ROOT, resolve(dirname(fromFile), specifier)));
	}

	return null;
};

const isUnder = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);

const violatesRules = (filePath: string, modulePath: string): boolean => {
	const importsEdopro = isUnder(modulePath, EDOPRO_DIR);

	if (importsEdopro && !isUnder(filePath, EDOPRO_DIR)) {
		return true;
	}

	return isUnder(filePath, SHARED_DIR) && (importsEdopro || isUnder(modulePath, YGOPRO_DIR));
};

const collectCouplings = (): string[] => {
	const couplings: string[] = [];
	for (const file of walk(SRC_ROOT)) {
		const filePath = toPosix(relative(PROJECT_ROOT, file));
		const content = readFileSync(file, "utf8");
		for (const specifier of importSpecifiers(content)) {
			const modulePath = resolveToSrcPath(file, specifier);
			if (modulePath && violatesRules(filePath, modulePath)) {
				couplings.push(`${filePath} -> ${modulePath}`);
			}
		}
	}

	return [...new Set(couplings)].sort();
};

describe("ArchitectureGuard", () => {
	it("blocks new EDOPro imports outside src/edopro and client imports from src/shared", () => {
		const couplings = collectCouplings();
		const allowed = new Set(KNOWN_COUPLINGS);
		const unexpected = couplings.filter((coupling) => !allowed.has(coupling));
		const stale = KNOWN_COUPLINGS.filter((coupling) => !couplings.includes(coupling));

		expect({ unexpectedCouplings: unexpected, staleAllowlistEntries: stale }).toEqual({
			unexpectedCouplings: [],
			staleAllowlistEntries: [],
		});
	});
});
