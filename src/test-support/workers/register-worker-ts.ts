/**
 * Jest cannot load yuzuthread worker classes natively: worker threads evaluate
 * TypeScript with Node's strip-only mode, which rejects decorators, parameter
 * properties and other non-erasable syntax. This helper patches
 * `worker_threads.Worker` so every worker created afterwards preloads ts-node
 * (transpile-only entry) via execArgv — the same TS support the dev server
 * gets from ts-node-dev.
 */
import path from "node:path";
import { Worker as NodeWorker, WorkerOptions } from "node:worker_threads";

// biome-ignore lint/style/noCommonJs: the CJS module object is required to patch the Worker export (ESM namespaces are read-only)
const workerThreads = require("node:worker_threads") as typeof import("node:worker_threads");

let registered = false;

export function registerWorkerTsSupport(): void {
	if (registered) {
		return;
	}
	registered = true;

	const tsNodeRegisterPath = require.resolve("ts-node/register/transpile-only", {
		paths: [path.dirname(require.resolve("ts-node-dev/package.json"))],
	});
	const OriginalWorker = workerThreads.Worker;
	const PatchedWorker = class PatchedWorker extends OriginalWorker {
		constructor(filename: string | URL, options: WorkerOptions = {}) {
			super(filename, {
				...options,
				execArgv: [...(options.execArgv ?? process.execArgv), "-r", tsNodeRegisterPath],
			});
		}
	} as unknown as typeof NodeWorker;
	workerThreads.Worker = PatchedWorker;
}
