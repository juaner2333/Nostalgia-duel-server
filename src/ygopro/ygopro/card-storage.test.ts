import { CardDataEntry } from "ygopro-cdb-encode";
import { CardStorage } from "./card-storage";

function card(code: number): CardDataEntry {
	const entry = new CardDataEntry();
	entry.code = code;
	entry.ot = 1;
	entry.strings = [];
	return entry;
}

describe("CardStorage", () => {
	it("creates an isolated view for an allowed card pool", () => {
		const wasm = Buffer.from("wasm");
		const storage = CardStorage.fromCards([card(1), card(2), card(3)], wasm);

		const filtered = storage.filterByCardIds(new Set([1, 3]));

		expect(filtered.size).toBe(2);
		expect(filtered.readCard(1)).toBeDefined();
		expect(filtered.readCard(2)).toBeUndefined();
		expect(filtered.readCard(3)).toBeDefined();
		expect(filtered.ocgcoreWasmBinary).toBe(wasm);
	});
});
