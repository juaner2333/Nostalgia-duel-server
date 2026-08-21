import { GameMode } from "ygopro-msg-encode";
import { getNostalgiaFormat, NOSTALGIA_FORMAT_IDS } from "./NostalgiaFormat";

describe("NostalgiaFormat", () => {
	it.each(["1103", "1109"] as const)("defines the fixed %s OCG match environment", (id) => {
		const format = getNostalgiaFormat(id);

		expect(format?.id).toBe(id);
		expect(format?.rule).toBe(0);
		expect(format?.duelRule).toBe(2);
		expect(format?.mode).toBe(GameMode.MATCH);
		expect(format?.startLp).toBe(8000);
		expect(format?.bestOf).toBe(3);
		expect(format?.banListName).toBe(`OCG ${id}`);
	});

	it("exposes only immutable enabled format IDs", () => {
		expect(NOSTALGIA_FORMAT_IDS).toEqual(["1103", "1109"]);
		expect(Object.isFrozen(NOSTALGIA_FORMAT_IDS)).toBe(true);
		expect(getNostalgiaFormat("1104")).toBeNull();
	});
});
