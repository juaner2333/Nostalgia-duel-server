import { extractTokenCodes } from "./token-script-scanner";

describe("token script scanner", () => {
	it("extracts plain CreateToken codes", () => {
		const codes = extractTokenCodes("local token=Duel.CreateToken(tp,44330099)\n");
		expect([...codes]).toEqual([44330099]);
	});

	it("extracts CreateToken codes expanded across a for loop", () => {
		const script = `
			for i=1,4 do
				local token=Duel.CreateToken(tp,73915051+i)
			end
		`;
		expect([...extractTokenCodes(script)].sort()).toEqual([73915052, 73915053, 73915054, 73915055]);
	});

	it("expands each looped CreateToken against its own preceding loop", () => {
		const script = `
			for i=1,2 do
				local a=Duel.CreateToken(tp,53855409+i)
			end
			for i=1,3 do
				local b=Duel.CreateToken(tp,29843091+i)
			end
		`;
		expect([...extractTokenCodes(script)].sort()).toEqual([
			29843092, 29843093, 29843094, 53855410, 53855411,
		]);
	});

	it("extracts token codes from IsPlayerCanSpecialSummonMonster with TYPES_TOKEN_MONSTER", () => {
		const script =
			"if not Duel.IsPlayerCanSpecialSummonMonster(tp,42956964,0x45,TYPES_TOKEN_MONSTER,2000,2000,6,RACE_FIEND,ATTRIBUTE_DARK) then return end\n";
		expect([...extractTokenCodes(script)]).toEqual([42956964]);
	});

	it("ignores non-token IsPlayerCanSpecialSummonMonster calls", () => {
		const script =
			"if not Duel.IsPlayerCanSpecialSummonMonster(tp,89631139,0,TYPE_MONSTER,3000,2500,8,RACE_DRAGON,ATTRIBUTE_LIGHT) then return end\n";
		expect([...extractTokenCodes(script)]).toEqual([]);
	});

	it("extracts codes from 1-tp (opponent) CreateToken calls", () => {
		const script =
			"local token=Duel.CreateToken(1-tp,71645243)\n" +
			"if not Duel.IsPlayerCanSpecialSummonMonster(1-tp,71645243,0,TYPES_TOKEN_MONSTER,800,800,2,RACE_PLANT,ATTRIBUTE_DARK) then return end\n";
		expect([...extractTokenCodes(script)]).toEqual([71645243]);
	});

	it("returns an empty set for scripts without token references", () => {
		expect([...extractTokenCodes("function c1.initial_effect(c) end")]).toEqual([]);
	});
});
