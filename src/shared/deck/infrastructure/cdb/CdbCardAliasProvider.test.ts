import path from "node:path";
import { CdbCardAliasProvider } from "./CdbCardAliasProvider";
import { classifyDeck } from "../../domain/classifier/DeckClassifier";

describe("CdbCardAliasProvider", () => {
	it("loads fixed cards.cdb and maps alt-art Rescue Rabbit 85138717 to canonical 85138716", async () => {
		const provider = new CdbCardAliasProvider();
		const aliases = await provider.getAliases("1109");

		expect(aliases.get(85138717)).toBe(85138716);
	});

	it("classifies alt-art Dino Rabbit deck as D03 when using CDB aliases, but OTHERS without aliases", async () => {
		// D03 requirements: 2x 85138716 (Rescue Rabbit), 1x 10802915 (Tour Guide), 2x 37265642 (Sabersaurus)
		// Here player uses 2x 85138717 (alt-art Rescue Rabbit)
		const fillerCards = Array.from({ length: 35 }, (_, i) => 10000000 + i);
		const deckWithAltArt = [85138717, 85138717, 10802915, 37265642, 37265642, ...fillerCards];

		// Without aliases -> OTHERS
		const unmappedResult = classifyDeck("1109", deckWithAltArt);
		expect(unmappedResult.deckTypeCode).toBe("OTHERS");

		// With CDB aliases -> D03
		const provider = new CdbCardAliasProvider();
		const aliases = await provider.getAliases("1109");
		const mappedResult = classifyDeck("1109", deckWithAltArt, aliases);
		expect(mappedResult.deckTypeCode).toBe("D03");
		expect(mappedResult.deckTypeNameZh).toBe("导游兔");
	});

	it("caches alias map on subsequent calls", async () => {
		const provider = new CdbCardAliasProvider();
		const first = await provider.getAliases("1109");
		const second = await provider.getAliases("1109");
		expect(first).toBe(second);
	});
});
