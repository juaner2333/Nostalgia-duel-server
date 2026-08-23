/**
 * Auxiliary worker for OcgcoreWorkerWasmModule.test.ts: echoes whether the
 * transported WebAssembly.Module survived the worker boundary as a real
 * WebAssembly.Module instance (a shelled {} would fail `instanceof`).
 *
 * Lives outside the test file so the worker thread never executes jest globals
 * (describe/it/expect) at module top level.
 */
import { DefineWorker, WorkerInit, WorkerMethod } from "yuzuthread";

import { OcgcoreWorkerOptions } from "../../ygopro/ocgcore-worker/ocgcore-worker-options";

@DefineWorker()
export class OcgcoreModuleProbeWorker {
	constructor(private readonly options: OcgcoreWorkerOptions) {}

	@WorkerInit()
	async init(): Promise<void> {
		// no-op: only the constructor transport matters for the probe
	}

	@WorkerMethod()
	async wasmModuleIsReal(): Promise<boolean> {
		return this.options.ocgcoreWasmModule instanceof WebAssembly.Module;
	}
}
