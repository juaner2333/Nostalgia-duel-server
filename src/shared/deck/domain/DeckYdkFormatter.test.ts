import {
	formatDeckToYdk,
	generateYdkFilename,
	formatBeijingDateForFilename,
	sanitizeFilenamePart,
} from "./DeckYdkFormatter";

describe("DeckYdkFormatter", () => {
	it("formats complete deck with main, extra, and side sections using CRLF", () => {
		const snapshot = {
			mainCards: [46986414, 46986414, 46986414, 33398782],
			extraCards: [83764718],
			sideCards: [18964575, 18964575],
		};

		const ydk = formatDeckToYdk(snapshot);

		expect(ydk).toBe(
			"#main\r\n46986414\r\n46986414\r\n46986414\r\n33398782\r\n#extra\r\n83764718\r\n!side\r\n18964575\r\n18964575\r\n",
		);
		// Preserves exact duplicate lines
		const mainLines = ydk.split("\r\n").filter((l) => l === "46986414");
		expect(mainLines).toHaveLength(3);
		// Does not contain any extra comments or tags
		expect(ydk).not.toContain("#created");
		expect(ydk).not.toContain("#pickup");
		expect(ydk).not.toContain("#case");
	});

	it("formats deck with null sideCards as partial deck keeping !side header", () => {
		const snapshot = {
			mainCards: [46986414, 33398782],
			extraCards: [83764718],
			sideCards: null,
		};

		const ydk = formatDeckToYdk(snapshot);

		expect(ydk).toBe("#main\r\n46986414\r\n33398782\r\n#extra\r\n83764718\r\n!side\r\n");
	});

	it("formats deck with empty sideCards as complete deck keeping !side header", () => {
		const snapshot = {
			mainCards: [46986414, 33398782],
			extraCards: [],
			sideCards: [],
		};

		const ydk = formatDeckToYdk(snapshot);

		expect(ydk).toBe("#main\r\n46986414\r\n33398782\r\n#extra\r\n!side\r\n");
	});

	it("generates safe filenames with date, player names, completeness, and .ydk extension", () => {
		const date = new Date("2026-09-02T12:30:45Z"); // UTC 12:30:45 -> Beijing 20:30:45
		const dateStr = formatBeijingDateForFilename(date);
		expect(dateStr).toBe("2026-09-02 20-30-45");

		const completeName = generateYdkFilename({
			date,
			playerName: "Alice/Play?er",
			opponentName: "Bob*Op:ponent",
			completeness: "complete",
		});
		expect(completeName).toBe("2026-09-02 20-30-45 Alice_Play_er VS Bob_Op_ponent (complete).ydk");

		const partialName = generateYdkFilename({
			date,
			playerName: "Charlie",
			opponentName: "Dave",
			completeness: "partial",
		});
		expect(partialName).toBe("2026-09-02 20-30-45 Charlie VS Dave (partial).ydk");
	});

	it("sanitizes unsafe characters and control characters in filename parts", () => {
		expect(sanitizeFilenamePart("NormalName")).toBe("NormalName");
		expect(sanitizeFilenamePart('Bad/\\?%*:|"<>Name\x00\x1f')).toBe("Bad__________Name");
		expect(sanitizeFilenamePart("   ")).toBe("unknown");
		expect(sanitizeFilenamePart("")).toBe("unknown");
	});
});
