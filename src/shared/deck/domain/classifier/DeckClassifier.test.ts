import {
	classifyDeck,
	CLASSIFIER_VERSIONS,
	DECK_TYPE_CATALOG,
	DeckClassificationResult,
} from "./DeckClassifier";

describe("DeckClassifier (1109 & 1103)", () => {
	const SAMPLES_1109: Record<string, { code: string; nameZh: string; main: number[] }> = {
		代行天使: {
			code: "D01",
			nameZh: "代行天使",
			main: [91188343, 55794644, 64734921],
		},
		HB: {
			code: "D02",
			nameZh: "HB",
			main: [69884162, 69884162, 33846209, 33846209, 37412656],
		},
		导游兔: {
			code: "D03",
			nameZh: "导游兔",
			main: [85138716, 85138716, 10802915, 37265642, 37265642],
		},
		血代齿轮: {
			code: "D04",
			nameZh: "血代齿轮",
			main: [80604091, 13839120, 41172955, 86445415],
		},
		龙骑兵团: {
			code: "D05",
			nameZh: "龙骑兵团",
			main: [62265044, 28183605, 59755122],
		},
		废二: {
			code: "D06",
			nameZh: "废二",
			main: [63977008, 63977008, 53855409],
		},
		暗黑界: {
			code: "D07",
			nameZh: "暗黑界",
			main: [34230233, 60228941, 33017655],
		},
		天狗植物: {
			code: "D08",
			nameZh: "天狗植物",
			main: [10028593, 10028593, 48686504, 15341821],
		},
		熔岩: {
			code: "D09",
			nameZh: "熔岩",
			main: [2407147, 2407147, 72142276],
		},
		光道: {
			code: "D11",
			nameZh: "光道",
			main: [57774843, 7183277, 21502796, 22624373, 95503687],
		},
		蛙帝: {
			code: "D12",
			nameZh: "蛙帝",
			main: [20663556, 12538374, 9748752, 73125233],
		},
		废铁: {
			code: "D13",
			nameZh: "废铁",
			main: [56746202, 19139516, 1050684],
		},
		永火: {
			code: "D14",
			nameZh: "永火",
			main: [99177923, 56209279, 66957584],
		},
		X剑士: {
			code: "D15",
			nameZh: "X剑士",
			main: [31383545, 51808422, 5998840],
		},
		遗式: {
			code: "D16",
			nameZh: "遗式",
			main: [46159582, 29888389, 11877465],
		},
		守墓: {
			code: "D17",
			nameZh: "守墓",
			main: [47355498, 24317029, 17393207, 93023479],
		},
		黑羽: {
			code: "D18",
			nameZh: "黑羽",
			main: [75498415, 75498415, 22835145, 22835145, 58820853, 58820853],
		},
		剑斗兽: {
			code: "D19",
			nameZh: "剑斗兽",
			main: [78868776, 78868776, 25924653, 25924653, 57731460],
		},
		六武众: {
			code: "D20",
			nameZh: "六武众",
			main: [1498130, 1498130, 1498130, 49721904, 49721904, 2511717],
		},
		变形斗士: {
			code: "D21",
			nameZh: "变形斗士",
			main: [93542102, 93542102, 93542102, 10591919, 10591919, 2250266, 2250266],
		},
		混沌均: {
			code: "D10",
			nameZh: "混沌均",
			main: [72989439, 65192027],
		},
		科技属: {
			code: "D22",
			nameZh: "科技属",
			main: [293542, 293542, 36687247, 1315120],
		},
		削血: {
			code: "D23",
			nameZh: "削血",
			main: [27053506, 27053506, 30461781, 24068492],
		},
		机巧: {
			code: "D24",
			nameZh: "机巧",
			main: [80204957, 30230789, 24621460],
		},
		水泡英雄: {
			code: "D25",
			nameZh: "水泡英雄",
			main: [79979666, 79979666, 45906428, 8949584],
		},
	};

	it("classifies all 25 supported categories for 1109", () => {
		for (const [categoryName, sample] of Object.entries(SAMPLES_1109)) {
			const result = classifyDeck("1109", sample.main);
			expect(result.deckTypeCode).toBe(sample.code);
			expect(result.deckTypeNameZh).toBe(sample.nameZh);
			expect(result.classifierVersion).toBe(CLASSIFIER_VERSIONS["1109"]);
			expect(result.evidence.length).toBeGreaterThan(0);
		}
	});

	it("classifies unrecognized deck as OTHERS", () => {
		const result = classifyDeck("1109", [83764718, 19613556]);
		expect(result.deckTypeCode).toBe("OTHERS");
		expect(result.deckTypeNameZh).toBe("其他");
		expect(result.classifierVersion).toBe(CLASSIFIER_VERSIONS["1109"]);
		expect(result.evidence).toEqual([]);
	});

	it("prefers specific archetype over chaos goodstuff (conflict priority)", () => {
		// Contains both Agents core and Chaos core
		const deck = [91188343, 55794644, 64734921, 72989439, 65192027];
		const result = classifyDeck("1109", deck);
		expect(result.deckTypeCode).toBe("D01"); // 代行天使
		expect(result.deckTypeNameZh).toBe("代行天使");
	});

	it("prefers HB over Bubble Hero when both conditions met", () => {
		// 69884162 (x2), 33846209 (x2), 45906428 (x1), 79979666 (x1)
		// Satisfies HB: 69884162 >= 2 && 33846209 >= 2 && total([37412656, 45906428, 213326]) >= 1
		// Also satisfies 水泡英雄: 79979666 >= 1 && total(...) >= 1
		const deck = [69884162, 69884162, 33846209, 33846209, 45906428, 79979666];
		const result = classifyDeck("1109", deck);
		expect(result.deckTypeCode).toBe("D02"); // HB
		expect(result.deckTypeNameZh).toBe("HB");
	});

	it("does not classify single blackwing splash as Blackwing", () => {
		const deck = [14785765, 72989439, 65192027];
		const result = classifyDeck("1109", deck);
		expect(result.deckTypeCode).toBe("D10"); // 混沌均
		expect(result.deckTypeNameZh).toBe("混沌均");
	});

	it("normalizes alternate card codes (aliases) for 1109", () => {
		// 69884163 is alias of 69884162 (Neos Alius)
		const deck = [69884163, 69884163, 33846209, 33846209, 37412656];
		const aliasMap = new Map<number, number>([[69884163, 69884162]]);
		const result = classifyDeck("1109", deck, aliasMap);
		expect(result.deckTypeCode).toBe("D02");
		expect(result.deckTypeNameZh).toBe("HB");
	});

	it("routes 1103 to OTHERS regardless of card contents", () => {
		// Even if main has perfect Agents core
		const deck = [91188343, 55794644, 64734921];
		const result = classifyDeck("1103", deck);
		expect(result.deckTypeCode).toBe("OTHERS");
		expect(result.deckTypeNameZh).toBe("其他");
		expect(result.classifierVersion).toBe(CLASSIFIER_VERSIONS["1103"]);
		expect(result.evidence).toEqual([]);
	});

	it("provides catalog metadata consistent with deck_types seed", () => {
		const catalog1109 = DECK_TYPE_CATALOG["1109"];
		expect(catalog1109).toHaveLength(26);
		expect(catalog1109[0]).toEqual({ code: "D01", nameZh: "代行天使", sortOrder: 0 });
		expect(catalog1109[24]).toEqual({ code: "D25", nameZh: "水泡英雄", sortOrder: 24 });
		expect(catalog1109[25]).toEqual({ code: "OTHERS", nameZh: "其他", sortOrder: 25 });

		const catalog1103 = DECK_TYPE_CATALOG["1103"];
		expect(catalog1103).toHaveLength(1);
		expect(catalog1103[0]).toEqual({ code: "OTHERS", nameZh: "其他", sortOrder: 0 });
	});
});
