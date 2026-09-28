export interface DeckClassificationResult {
	formatId: string;
	deckTypeCode: string;
	deckTypeNameZh: string;
	classifierVersion: string;
	evidence: number[];
}

export interface DeckTypeMetadata {
	code: string;
	nameZh: string;
	sortOrder: number;
}

export const CLASSIFIER_VERSIONS: Record<string, string> = {
	"1109": "1109-c9ba01c-v2",
	"1103": "1103-fallback-v1",
};

export const DECK_TYPE_CATALOG: Record<string, readonly DeckTypeMetadata[]> = {
	"1103": Object.freeze([{ code: "OTHERS", nameZh: "其他", sortOrder: 0 }]),
	"1109": Object.freeze([
		{ code: "D01", nameZh: "代行天使", sortOrder: 0 },
		{ code: "D02", nameZh: "HB", sortOrder: 1 },
		{ code: "D03", nameZh: "导游兔", sortOrder: 2 },
		{ code: "D04", nameZh: "血代齿轮", sortOrder: 3 },
		{ code: "D05", nameZh: "龙骑兵团", sortOrder: 4 },
		{ code: "D06", nameZh: "废二", sortOrder: 5 },
		{ code: "D07", nameZh: "暗黑界", sortOrder: 6 },
		{ code: "D08", nameZh: "天狗植物", sortOrder: 7 },
		{ code: "D09", nameZh: "熔岩", sortOrder: 8 },
		{ code: "D10", nameZh: "混沌均", sortOrder: 9 },
		{ code: "D11", nameZh: "光道", sortOrder: 10 },
		{ code: "D12", nameZh: "蛙帝", sortOrder: 11 },
		{ code: "D13", nameZh: "废铁", sortOrder: 12 },
		{ code: "D14", nameZh: "永火", sortOrder: 13 },
		{ code: "D15", nameZh: "X剑士", sortOrder: 14 },
		{ code: "D16", nameZh: "遗式", sortOrder: 15 },
		{ code: "D17", nameZh: "守墓", sortOrder: 16 },
		{ code: "D18", nameZh: "黑羽", sortOrder: 17 },
		{ code: "D19", nameZh: "剑斗兽", sortOrder: 18 },
		{ code: "D20", nameZh: "六武众", sortOrder: 19 },
		{ code: "D21", nameZh: "变形斗士", sortOrder: 20 },
		{ code: "D22", nameZh: "科技属", sortOrder: 21 },
		{ code: "D23", nameZh: "削血", sortOrder: 22 },
		{ code: "D24", nameZh: "机巧", sortOrder: 23 },
		{ code: "D25", nameZh: "水泡英雄", sortOrder: 24 },
		{ code: "D26", nameZh: "神风鹰身", sortOrder: 25 },
		{ code: "D27", nameZh: "念动力", sortOrder: 26 },
		{ code: "D28", nameZh: "纯电子龙", sortOrder: 27 },
		{ code: "D29", nameZh: "宝石骑士", sortOrder: 28 },
		{ code: "D30", nameZh: "不死均", sortOrder: 29 },
		{ code: "OTHERS", nameZh: "其他", sortOrder: 30 },
	]),
};

const BLACKWING_MONSTERS = new Set<number>([
	2009101, 3072808, 4068622, 9109991, 11613567, 14785765, 16516630, 22835145, 26775203, 38562933,
	41902352, 46710683, 49003716, 49460512, 52869807, 52900379, 58820853, 72714392, 75498415,
	78564023, 85215458, 87390067, 88305978, 89258906,
]);

const GLADIATOR_BEAST_MONSTERS = new Set<number>([
	612115, 2067935, 2619149, 4253484, 5975022, 25924653, 29590752, 31247589, 41470137, 42592719,
	50893987, 57731460, 65984457, 73285669, 77642288, 78868776, 79580323, 90582719, 90957527,
]);

const SIX_SAMURAI_MONSTERS = new Set<number>([
	1498130, 2511717, 27178262, 27782503, 31904181, 44430454, 48505422, 49721904, 61737116, 64398890,
	65685470, 69025477, 74094021, 75116619, 78792195, 83039729, 90397998, 95519486,
]);

const MORPHTRONIC_MONSTERS = new Set<number>([
	2250266, 10591919, 28124263, 28284902, 29947751, 45593005, 48381268, 48868994, 55119278, 57108202,
	66331855, 75775867, 76865611, 84592800, 91607976, 92720564, 93542102,
]);

const TG_MONSTERS = new Set<number>([293542, 36687247, 1315120]);

const KARAKURI_CARDS = new Set<number>([
	80204957, 30230789, 24621460, 3846170, 24150026, 66625883, 6276588,
]);

const BURN_CARDS = new Set<number>([
	27053506, 24068492, 77622396, 27301787, 3510565, 80036543, 98444741, 30461781,
]);

const GEM_KNIGHT_MONSTERS = new Set<number>([
	19163116, 45662855, 54620698, 91731841, 72056560, 27126980, 8692301, 13108445,
]);

const ZOMBIE_CORE_CARDS = new Set<number>([92826944, 2204140, 63665875, 17259470, 77044671]);

export function normalizeCardCounts(
	cards: readonly number[],
	aliases?: ReadonlyMap<number, number> | Record<number, number>,
): Map<number, number> {
	const counts = new Map<number, number>();

	const getAlias = (id: number): number => {
		if (!aliases) return id;
		if (aliases instanceof Map) return aliases.get(id) ?? id;
		return (aliases as Record<number, number>)[id] ?? id;
	};

	const canonical = (cardId: number): number => {
		if (!aliases) return cardId;
		const seen = new Set<number>();
		let current = cardId;
		let next = getAlias(current);
		while (next !== 0 && next !== current && !seen.has(current)) {
			seen.add(current);
			current = next;
			next = getAlias(current);
		}
		return current;
	};

	for (const cardId of cards) {
		const canon = canonical(cardId);
		counts.set(canon, (counts.get(canon) ?? 0) + 1);
	}

	return counts;
}

interface RuleDefinition {
	code: string;
	nameZh: string;
	candidateEvidence: readonly number[];
	matches: (
		count: (id: number) => number,
		total: (ids: Iterable<number>) => number,
		distinct: (ids: Iterable<number>) => number,
	) => boolean;
}

const RULES_1109: readonly RuleDefinition[] = [
	{
		code: "D01",
		nameZh: "代行天使",
		candidateEvidence: [91188343, 55794644, 64734921, 39552864],
		matches: (count) =>
			count(91188343) >= 1 &&
			count(55794644) >= 1 &&
			(count(64734921) >= 1 || count(39552864) >= 2),
	},
	{
		code: "D02",
		nameZh: "HB",
		candidateEvidence: [69884162, 33846209, 37412656, 45906428, 213326],
		matches: (count, total) =>
			count(69884162) >= 2 && count(33846209) >= 2 && total([37412656, 45906428, 213326]) >= 1,
	},
	{
		code: "D25",
		nameZh: "水泡英雄",
		candidateEvidence: [79979666, 45906428, 8949584, 69884162, 213326],
		matches: (count, total) =>
			count(79979666) >= 1 && total([45906428, 8949584, 69884162, 213326]) >= 1,
	},
	{
		code: "D03",
		nameZh: "导游兔",
		candidateEvidence: [85138716, 10802915, 37265642],
		matches: (count) => count(85138716) >= 2 && count(10802915) >= 1 && count(37265642) >= 2,
	},
	{
		code: "D04",
		nameZh: "血代齿轮",
		candidateEvidence: [80604091, 13839120, 41172955, 86445415],
		matches: (count) =>
			count(80604091) >= 1 && count(13839120) >= 1 && count(41172955) >= 1 && count(86445415) >= 1,
	},
	{
		code: "D05",
		nameZh: "龙骑兵团",
		candidateEvidence: [62265044, 28183605, 59755122],
		matches: (count) => count(62265044) >= 1 && count(28183605) >= 1 && count(59755122) >= 1,
	},
	{
		code: "D06",
		nameZh: "废二",
		candidateEvidence: [63977008, 53855409],
		matches: (count, total) =>
			count(63977008) >= 1 && count(53855409) >= 1 && total([63977008, 53855409]) >= 3,
	},
	{
		code: "D07",
		nameZh: "暗黑界",
		candidateEvidence: [34230233, 60228941, 33017655],
		matches: (count) => count(34230233) >= 1 && count(60228941) >= 1 && count(33017655) >= 1,
	},
	{
		code: "D08",
		nameZh: "天狗植物",
		candidateEvidence: [10028593, 48686504, 15341821, 11747708, 67441435],
		matches: (count, _total, distinct) =>
			count(10028593) >= 2 && distinct([48686504, 15341821, 11747708, 67441435]) >= 2,
	},
	{
		code: "D09",
		nameZh: "熔岩",
		candidateEvidence: [2407147, 72142276, 74845897],
		matches: (count, total) => count(2407147) >= 2 && total([72142276, 74845897]) >= 1,
	},
	{
		code: "D11",
		nameZh: "光道",
		candidateEvidence: [
			57774843, 691925, 94886282, 7183277, 21502796, 22624373, 44178886, 58996430, 59019082,
			95503687, 96235275,
		],
		matches: (count, _total, distinct) =>
			distinct([7183277, 21502796, 22624373, 44178886, 58996430, 59019082, 95503687, 96235275]) >=
				4 &&
			(count(57774843) >= 1 || count(691925) >= 2),
	},
	{
		code: "D12",
		nameZh: "蛙帝",
		candidateEvidence: [20663556, 12538374, 4929256, 9748752, 26205777, 73125233],
		matches: (count, total) =>
			count(20663556) >= 1 &&
			count(12538374) >= 1 &&
			total([4929256, 9748752, 26205777, 51945556, 57666212, 60229110, 73125233]) >= 2,
	},
	{
		code: "D13",
		nameZh: "废铁",
		candidateEvidence: [56746202, 19139516, 1050684, 48445393],
		matches: (count, total) =>
			count(56746202) >= 1 && count(19139516) >= 1 && total([1050684, 48445393]) >= 1,
	},
	{
		code: "D14",
		nameZh: "永火",
		candidateEvidence: [99177923, 56209279, 66957584, 14550855, 9059700],
		matches: (count, total) =>
			count(99177923) >= 1 && count(56209279) >= 1 && total([66957584, 14550855, 9059700]) >= 1,
	},
	{
		code: "D15",
		nameZh: "X剑士",
		candidateEvidence: [31383545, 51808422, 5998840, 42737833],
		matches: (count, total) =>
			count(31383545) >= 1 && count(51808422) >= 1 && total([5998840, 42737833]) >= 1,
	},
	{
		code: "D16",
		nameZh: "遗式",
		candidateEvidence: [
			46159582, 29888389, 11877465, 21496848, 45222299, 57272170, 71203602, 76372778,
		],
		matches: (count, total) =>
			count(46159582) >= 1 &&
			count(29888389) >= 1 &&
			total([11877465, 21496848, 45222299, 57272170, 71203602, 76372778]) >= 1,
	},
	{
		code: "D17",
		nameZh: "守墓",
		candidateEvidence: [47355498, 24317029, 17393207, 93023479, 30213599],
		matches: (count, _total, distinct) =>
			count(47355498) >= 1 && distinct([24317029, 17393207, 93023479, 30213599]) >= 3,
	},
	{
		code: "D18",
		nameZh: "黑羽",
		candidateEvidence: Array.from(BLACKWING_MONSTERS).sort((a, b) => a - b),
		matches: (_count, total, distinct) =>
			distinct(BLACKWING_MONSTERS) >= 3 && total(BLACKWING_MONSTERS) >= 6,
	},
	{
		code: "D19",
		nameZh: "剑斗兽",
		candidateEvidence: Array.from(GLADIATOR_BEAST_MONSTERS).sort((a, b) => a - b),
		matches: (_count, total, distinct) =>
			distinct(GLADIATOR_BEAST_MONSTERS) >= 3 && total(GLADIATOR_BEAST_MONSTERS) >= 5,
	},
	{
		code: "D20",
		nameZh: "六武众",
		candidateEvidence: Array.from(SIX_SAMURAI_MONSTERS).sort((a, b) => a - b),
		matches: (_count, total, distinct) =>
			distinct(SIX_SAMURAI_MONSTERS) >= 3 && total(SIX_SAMURAI_MONSTERS) >= 6,
	},
	{
		code: "D21",
		nameZh: "变形斗士",
		candidateEvidence: Array.from(MORPHTRONIC_MONSTERS).sort((a, b) => a - b),
		matches: (_count, total, distinct) =>
			distinct(MORPHTRONIC_MONSTERS) >= 3 && total(MORPHTRONIC_MONSTERS) >= 7,
	},
	{
		code: "D22",
		nameZh: "科技属",
		candidateEvidence: Array.from(TG_MONSTERS).sort((a, b) => a - b),
		matches: (_count, total) => total(TG_MONSTERS) >= 3,
	},
	{
		code: "D24",
		nameZh: "机巧",
		candidateEvidence: Array.from(KARAKURI_CARDS).sort((a, b) => a - b),
		matches: (_count, total, distinct) =>
			distinct(KARAKURI_CARDS) >= 2 && total(KARAKURI_CARDS) >= 3,
	},
	{
		code: "D23",
		nameZh: "削血",
		candidateEvidence: Array.from(BURN_CARDS).sort((a, b) => a - b),
		matches: (_count, total) =>
			total([27053506, 24068492, 77622396, 27301787, 3510565, 80036543]) >= 2 ||
			total(BURN_CARDS) >= 4,
	},
	{
		code: "D26",
		nameZh: "神风鹰身",
		candidateEvidence: [15854426, 75064463, 75782277, 77778835, 82199284],
		matches: (count, total) =>
			(count(15854426) >= 1 &&
				(total([75064463, 75782277, 77778835, 76812113, 12206212, 82199284]) >= 1 ||
					count(82199284) >= 1)) ||
			total([75064463, 75782277, 77778835]) >= 2 ||
			(count(82199284) >= 2 && count(22837504) >= 1),
	},
	{
		code: "D27",
		nameZh: "念动力",
		candidateEvidence: [67723438, 21454943, 13440154, 60999392, 36484016],
		matches: (count, total) =>
			(count(36484016) >= 1 && total([67723438, 21454943, 13440154, 60999392]) >= 1) ||
			total([13440154, 60999392, 6631034, 15883905]) >= 2 ||
			(count(67723438) >= 1 &&
				count(21454943) >= 1 &&
				total([13440154, 60999392, 36484016, 6631034]) >= 1),
	},
	{
		code: "D28",
		nameZh: "纯电子龙",
		candidateEvidence: [70095154, 46461247, 5373478, 3659803],
		matches: (count, total) =>
			(count(70095154) >= 2 &&
				(total([46461247, 5373478, 3659803, 63995093]) >= 1 || count(70095154) === 3)) ||
			total([46461247, 5373478]) >= 2,
	},
	{
		code: "D29",
		nameZh: "宝石骑士",
		candidateEvidence: [1264319, 27004302, 45662855, 19163116],
		matches: (_count, total, distinct) =>
			total([1264319, 1264320, 27004302]) >= 1 || distinct(GEM_KNIGHT_MONSTERS) >= 2,
	},
	{
		code: "D30",
		nameZh: "不死均",
		candidateEvidence: [92826944, 2204140, 63665875, 17259470],
		matches: (count, total) =>
			(count(92826944) >= 1 ||
				count(2204140) >= 1 ||
				count(17259470) >= 1 ||
				count(63665875) >= 1) &&
			(total(ZOMBIE_CORE_CARDS) >= 2 || (total(ZOMBIE_CORE_CARDS) >= 1 && count(33420078) >= 1)),
	},
	{
		code: "D10",
		nameZh: "混沌均",
		candidateEvidence: [72989439, 9596126, 65192027],
		matches: (_count, total) =>
			total([72989439, 9596126]) >= 1 && total([72989439, 9596126, 65192027]) >= 2,
	},
];

export function classifyDeck(
	formatId: string,
	mainCards: readonly number[],
	aliases?: ReadonlyMap<number, number> | Record<number, number>,
): DeckClassificationResult {
	const version = CLASSIFIER_VERSIONS[formatId] ?? `${formatId}-fallback-v1`;

	if (formatId !== "1109") {
		return {
			formatId,
			deckTypeCode: "OTHERS",
			deckTypeNameZh: "其他",
			classifierVersion: version,
			evidence: [],
		};
	}

	const counts = normalizeCardCounts(mainCards, aliases);
	const count = (id: number): number => counts.get(id) ?? 0;
	const total = (ids: Iterable<number>): number => {
		let sum = 0;
		for (const id of ids) {
			sum += counts.get(id) ?? 0;
		}
		return sum;
	};
	const distinct = (ids: Iterable<number>): number => {
		let d = 0;
		for (const id of ids) {
			if ((counts.get(id) ?? 0) > 0) {
				d++;
			}
		}
		return d;
	};

	for (const rule of RULES_1109) {
		if (rule.matches(count, total, distinct)) {
			const evidence = rule.candidateEvidence.filter((id) => count(id) > 0);
			return {
				formatId,
				deckTypeCode: rule.code,
				deckTypeNameZh: rule.nameZh,
				classifierVersion: version,
				evidence,
			};
		}
	}

	return {
		formatId,
		deckTypeCode: "OTHERS",
		deckTypeNameZh: "其他",
		classifierVersion: version,
		evidence: [],
	};
}
