import { YGOProLFListItem } from "ygopro-lflist-encode";

import { YGOProResourceLoader } from "../../ygopro/YGOProResourceLoader";
import { YGOProBanListLoader } from "./YGOProBanListLoader";
import YGOProBanListMemoryRepository from "./YGOProBanListMemoryRepository";

const OCG_1103_LF_LIST = [
	"#[OCG 1103]",
	"!OCG 1103",
	"$whitelist",
	"21044178 0 --Abyss Dweller",
	"89631139 1 --Dark Magician",
	"53582587 2 --Pot of Desires",
	"440556 3 --Bahamut Shark",
].join("\n");

const OCG_1109_LF_LIST = [
	"#[OCG 1109]",
	"!OCG 1109",
	"$whitelist",
	"21044178 0 --Abyss Dweller",
	"89631139 1 --Dark Magician",
	"572850 3 --Tearlaments Scheiren",
].join("\n");

const OCG_1103_HASH = new YGOProLFListItem().fromText(OCG_1103_LF_LIST).getHash();
const OCG_1109_HASH = new YGOProLFListItem().fromText(OCG_1109_LF_LIST).getHash();

describe("YGOProBanListLoader", () => {
	beforeEach(() => {
		YGOProBanListMemoryRepository.clear();
		jest.spyOn(YGOProResourceLoader, "get").mockReturnValue({
			getLFLists: async function* () {
				yield {
					item: new YGOProLFListItem().fromText(OCG_1103_LF_LIST),
					text: OCG_1103_LF_LIST,
				};
				yield {
					item: new YGOProLFListItem().fromText(OCG_1109_LF_LIST),
					text: OCG_1109_LF_LIST,
				};
			},
		} as unknown as YGOProResourceLoader);
	});

	afterEach(() => {
		jest.restoreAllMocks();
		YGOProBanListMemoryRepository.clear();
	});

	it("loads both fixed whitelist lists under their YGOPro hashes", async () => {
		await new YGOProBanListLoader().load();

		expect(YGOProBanListMemoryRepository.findByHash(OCG_1103_HASH)).toMatchObject({
			name: "OCG 1103",
			forbidden: [21044178],
			limited: [89631139],
			semiLimited: [53582587],
			all: [440556],
		});
		expect(YGOProBanListMemoryRepository.findByHash(OCG_1109_HASH)).toMatchObject({
			name: "OCG 1109",
			forbidden: [21044178],
			limited: [89631139],
			all: [572850],
		});
	});
});
