import { createRequire } from "node:module";
import path from "node:path";
import { createOcgcoreWrapper, OcgcoreWrapper } from "koishipro-core.js";
import type { NostalgiaFormatId } from "../room/domain/NostalgiaFormat";

const GOAT_CORE_DIR = path.resolve("vendor/goat-core");
const requireCore = createRequire(__filename);
type CoreModule = ConstructorParameters<typeof OcgcoreWrapper>[0];
type CoreFactory = (options: Partial<CoreModule>) => Promise<CoreModule>;

export function resolveDuelCoreWasmPath(formatId?: NostalgiaFormatId): string {
	const coreDir =
		formatId === "goat"
			? GOAT_CORE_DIR
			: path.join(path.dirname(requireCore.resolve("koishipro-core.js")), "vendor/wasm_cjs");
	return path.join(coreDir, "libocgcore.wasm");
}

export async function createDuelCoreWrapper(
	formatId?: NostalgiaFormatId,
	moduleOverrides?: Partial<CoreModule>,
): Promise<OcgcoreWrapper> {
	if (formatId !== "goat") {
		return createOcgcoreWrapper({ moduleOverrides });
	}
	const factory: CoreFactory = requireCore(path.join(GOAT_CORE_DIR, "libocgcore.cjs"));
	const module = await factory({
		quit: () => {
			// The wrapper finalizes the duel without exiting the Node worker.
		},
		...moduleOverrides,
	});
	return new OcgcoreWrapper(module);
}
