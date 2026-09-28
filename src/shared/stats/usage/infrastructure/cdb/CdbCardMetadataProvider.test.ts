import { CdbCardMetadataProvider } from "./CdbCardMetadataProvider";
import { CardTypes } from "@shared/card/domain/CardTypes";

describe("CdbCardMetadataProvider", () => {
	it("loads base cards.cdb, maps alt-art to canonical, and returns metadata", async () => {
		const provider = new CdbCardMetadataProvider();
		await provider.load();

		// Mystical Space Typhoon
		const mst = provider.getCardMetadata(5318639);
		expect(mst).toBeDefined();
		expect(mst?.name).toBe("旋风");
		expect((mst!.type & CardTypes.TYPE_SPELL) !== 0).toBe(true);

		// Mirror Force
		const mf = provider.getCardMetadata(44095762);
		expect(mf).toBeDefined();
		expect(mf?.name).toBe("神圣防护罩 -反射镜力-");
		expect((mf!.type & CardTypes.TYPE_TRAP) !== 0).toBe(true);

		// Alt-art Rescue Rabbit (85138717) maps to canonical 85138716
		expect(provider.getCanonicalCardId(85138717)).toBe(85138716);
		// Normal card maps to itself
		expect(provider.getCanonicalCardId(85138716)).toBe(85138716);

		// hasCard
		expect(provider.hasCard(85138716)).toBe(true);
		expect(provider.hasCard(999999999)).toBe(false);
	});

	it("throws error when CDB file does not exist", async () => {
		const invalidProvider = new CdbCardMetadataProvider("/path/to/non-existent.cdb");
		await expect(invalidProvider.load()).rejects.toThrow("Fixed cards.cdb not found");
	});
});
