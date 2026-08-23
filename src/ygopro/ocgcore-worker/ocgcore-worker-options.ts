import YGOProDeck from "ygopro-deck-encode";
import { HostInfo } from "ygopro-msg-encode";
import { TransportEncoder, TransportType } from "yuzuthread";
import { CardStorage } from "../ygopro/card-storage";

export class OcgcoreWorkerOptions {
	ygoproPaths: string[];
	extraScriptPaths: string[];
	@TransportType(() => CardStorage)
	cardStorage: CardStorage;
	// Identity encoder ONLY — never combine with @TransportType: both write the
	// same "transporter" metadata key and the later decorator wins. If TransportType
	// won, WebAssembly.Module would take the CustomClass branch and be serialized
	// into a shell {} (it has no enumerable own properties). With encoder-only
	// transport the raw module passes through and postMessage's structured clone
	// transfers it to the worker natively.
	@TransportEncoder<unknown, unknown>(
		(module) => module,
		(module) => module,
	)
	ocgcoreWasmModule: unknown;
	seed: number[];
	hostinfo: HostInfo;
	@TransportType(() => [YGOProDeck])
	decks: YGOProDeck[];
	registry: Record<string, string>;
}
