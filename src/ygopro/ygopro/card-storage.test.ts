import { CardDataEntry } from "ygopro-cdb-encode";
import { CardStorage } from "./card-storage";

function card(code: number, type = 0): CardDataEntry {
	const entry = new CardDataEntry();
	entry.code = code;
	entry.ot = 1;
	entry.type = type;
	entry.strings = [];
	return entry;
}

describe("CardStorage", () => {
	it("creates an isolated view for an allowed card pool", () => {
		const storage = CardStorage.fromCards([card(1), card(2), card(3)]);

		const filtered = storage.filterByCardIds(new Set([1, 3]));

		expect(filtered.size).toBe(2);
		expect(filtered.readCard(1)).toBeDefined();
		expect(filtered.readCard(2)).toBeUndefined();
		expect(filtered.readCard(3)).toBeDefined();
	});

	it("keeps token cards alongside the allowed card pool", () => {
		const storage = CardStorage.fromCards([card(1), card(2, 0x4000 | 0x1), card(3)]);

		const filtered = storage.filterForFormat(new Set([1, 3]));

		expect(filtered.size).toBe(3);
		expect(filtered.readCard(1)).toBeDefined();
		expect(filtered.readCard(2)).toBeDefined();
		expect(filtered.readCard(3)).toBeDefined();
	});

	it("drops non-token cards outside the allowed card pool", () => {
		const storage = CardStorage.fromCards([card(1), card(2), card(3)]);

		const filtered = storage.filterForFormat(new Set([1]));

		expect(filtered.size).toBe(1);
		expect(filtered.readCard(1)).toBeDefined();
		expect(filtered.readCard(2)).toBeUndefined();
		expect(filtered.readCard(3)).toBeUndefined();
	});
});
