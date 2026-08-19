import { YGOProLFListItem } from "ygopro-lflist-encode";

import { YGOProResourceLoader } from "../../ygopro/YGOProResourceLoader";
import { YGOProBanListLoader } from "./YGOProBanListLoader";
import YGOProBanListMemoryRepository from "./YGOProBanListMemoryRepository";

const NORMAL_LF_LIST = [
	"#[2026.01]",
	"!2026.01",
	"#Forbidden",
	"21044178 0 --Abyss Dweller",
	"62320425 0 --Agido the Ancient Sentry",
	"#Limited",
	"89631139 1 --Dark Magician",
	"#Semi limit",
	"53582587 2 --Pot of Desires",
].join("\n");

const GENESYS_LF_LIST = [
	"#[Genesys]",
	"!Genesys",
	"440556 3 81 --Bahamut Shark",
	"572850 3 50 --Tearlaments Scheiren",
	"21044178 0 --Abyss Dweller",
	"89631139 1 --Dark Magician",
].join("\n");

// Content hashes seeded with 0x7dfcee6a, precomputed from the fixtures above.
// Fixed on purpose: the loader must preserve the ygopro-lflist-encode hash
// verbatim, not recompute it.
const NORMAL_HASH = 3948153423;
const GENESYS_HASH = 342330484;

describe("YGOProBanListLoader", () => {
	beforeEach(() => {
		YGOProBanListMemoryRepository.clear();
		jest.spyOn(YGOProResourceLoader, "get").mockReturnValue({
			getLFLists: async function* () {
				yield { item: new YGOProLFListItem().fromText(NORMAL_LF_LIST), text: NORMAL_LF_LIST };
				yield { item: new YGOProLFListItem().fromText(GENESYS_LF_LIST), text: GENESYS_LF_LIST };
			},
		} as unknown as YGOProResourceLoader);
	});

	afterEach(() => {
		jest.restoreAllMocks();
		YGOProBanListMemoryRepository.clear();
	});

	it("loads a normal lflist under its ygopro hash with the OCG-suffixed name", async () => {
		await new YGOProBanListLoader().load();

		const normal = YGOProBanListMemoryRepository.findByHash(NORMAL_HASH);
		expect(normal).not.toBeNull();
		expect(normal?.name).toBe("2026.01 OCG");
		expect(normal?.forbidden).toEqual([21044178, 62320425]);
		expect(normal?.limited).toEqual([89631139]);
		expect(normal?.semiLimited).toEqual([53582587]);
	});

	it("loads the Genesys points lflist under its ygopro hash and recovers point costs", async () => {
		await new YGOProBanListLoader().load();

		const genesys = YGOProBanListMemoryRepository.findByHash(GENESYS_HASH);
		expect(genesys).not.toBeNull();
		expect(genesys?.name).toBe("Genesys");
		expect(genesys?.isGenesys()).toBe(true);
		// The library only keeps limit 0-2 entries, so the hash covers those alone;
		// limit-3 Genesys entries and their point costs are recovered from raw text.
		expect(genesys?.forbidden).toEqual([21044178]);
		expect(genesys?.limited).toEqual([89631139]);
		expect(genesys?.all).toEqual([440556, 572850]);
		expect(genesys?.points.get(440556)).toBe(81);
		expect(genesys?.points.get(572850)).toBe(50);
	});

	it("keeps hashes distinct between the two lists", async () => {
		await new YGOProBanListLoader().load();

		expect(NORMAL_HASH).not.toBe(GENESYS_HASH);
		expect(YGOProBanListMemoryRepository.get()).toHaveLength(2);
	});
});
