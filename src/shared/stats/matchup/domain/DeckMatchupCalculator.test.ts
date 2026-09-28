import { DeckMatchupCalculator, RawPhysicalMatchPerspective } from "./DeckMatchupCalculator";

describe("DeckMatchupCalculator (Tasks 4.2 & 4.3)", () => {
	const top15Decks = ["HERO_BEAT", "SIX_SAMURAI", "DARK_WORLD", "INZEKTOR", "RABBIT"];
	const windowStart = "2026-07-01";

	function makePerspective(
		overrides: Partial<RawPhysicalMatchPerspective> & {
			gameId: string;
			userId: string;
		},
	): RawPhysicalMatchPerspective {
		return {
			matchId: `m-${overrides.gameId}-${overrides.userId}`,
			formatId: "1109",
			winner: true,
			playerScore: 2,
			opponentScore: 1,
			isAnnulled: false,
			isDeleted: false,
			deckTypeCode: "HERO_BEAT",
			g1IsFirst: true,
			...overrides,
		};
	}

	it("returns empty result for non-1109 format", () => {
		const perspectives = [
			makePerspective({ gameId: "g1", userId: "u1", formatId: "1103" }),
			makePerspective({
				gameId: "g1",
				userId: "u2",
				formatId: "1103",
				winner: false,
				playerScore: 1,
				opponentScore: 2,
				g1IsFirst: false,
			}),
		];
		const result = DeckMatchupCalculator.calculate("1103", windowStart, top15Decks, perspectives);
		expect(result.admittedPhysicalMatches).toBe(0);
		expect(result.matchupRows).toEqual([]);
	});

	it("admits valid match between two top 15 decks and counts first won", () => {
		// HERO_BEAT (p1, first, winner) vs SIX_SAMURAI (p2, second, loser)
		const perspectives = [
			makePerspective({
				gameId: "g1",
				userId: "u1",
				deckTypeCode: "HERO_BEAT",
				winner: true,
				playerScore: 2,
				opponentScore: 0,
				g1IsFirst: true,
			}),
			makePerspective({
				gameId: "g1",
				userId: "u2",
				deckTypeCode: "SIX_SAMURAI",
				winner: false,
				playerScore: 0,
				opponentScore: 2,
				g1IsFirst: false,
			}),
		];

		const result = DeckMatchupCalculator.calculate("1109", windowStart, top15Decks, perspectives);
		expect(result.totalPhysicalMatches).toBe(1);
		expect(result.admittedPhysicalMatches).toBe(1);
		expect(result.matchupRows).toHaveLength(1);
		expect(result.matchupRows[0]).toEqual({
			formatId: "1109",
			windowStart,
			firstDeckCode: "HERO_BEAT",
			secondDeckCode: "SIX_SAMURAI",
			matchCount: 1,
			firstWins: 1,
		});
	});

	it("accumulates distinct physical matches for opposing directions", () => {
		// Game 1: HERO_BEAT (first, win) vs SIX_SAMURAI (second, lose)
		// Game 2: SIX_SAMURAI (first, lose) vs HERO_BEAT (second, win)
		const perspectives = [
			makePerspective({
				gameId: "g1",
				userId: "u1",
				deckTypeCode: "HERO_BEAT",
				winner: true,
				playerScore: 2,
				opponentScore: 0,
				g1IsFirst: true,
			}),
			makePerspective({
				gameId: "g1",
				userId: "u2",
				deckTypeCode: "SIX_SAMURAI",
				winner: false,
				playerScore: 0,
				opponentScore: 2,
				g1IsFirst: false,
			}),
			makePerspective({
				gameId: "g2",
				userId: "u3",
				deckTypeCode: "SIX_SAMURAI",
				winner: false,
				playerScore: 1,
				opponentScore: 2,
				g1IsFirst: true,
			}),
			makePerspective({
				gameId: "g2",
				userId: "u4",
				deckTypeCode: "HERO_BEAT",
				winner: true,
				playerScore: 2,
				opponentScore: 1,
				g1IsFirst: false,
			}),
		];

		const result = DeckMatchupCalculator.calculate("1109", windowStart, top15Decks, perspectives);
		expect(result.totalPhysicalMatches).toBe(2);
		expect(result.admittedPhysicalMatches).toBe(2);
		expect(result.matchupRows).toHaveLength(2);

		const heroVsSix = result.matchupRows.find(
			(r) => r.firstDeckCode === "HERO_BEAT" && r.secondDeckCode === "SIX_SAMURAI",
		);
		expect(heroVsSix).toEqual({
			formatId: "1109",
			windowStart,
			firstDeckCode: "HERO_BEAT",
			secondDeckCode: "SIX_SAMURAI",
			matchCount: 1,
			firstWins: 1,
		});

		const sixVsHero = result.matchupRows.find(
			(r) => r.firstDeckCode === "SIX_SAMURAI" && r.secondDeckCode === "HERO_BEAT",
		);
		expect(sixVsHero).toEqual({
			formatId: "1109",
			windowStart,
			firstDeckCode: "SIX_SAMURAI",
			secondDeckCode: "HERO_BEAT",
			matchCount: 1,
			firstWins: 0, // First player (SIX_SAMURAI) lost
		});
	});

	it("accumulates mirror match into single (X, X) physical matchup row", () => {
		// HERO_BEAT vs HERO_BEAT: p1 (first, win), p2 (second, lose)
		const perspectives = [
			makePerspective({
				gameId: "g1",
				userId: "u1",
				deckTypeCode: "HERO_BEAT",
				winner: true,
				playerScore: 2,
				opponentScore: 1,
				g1IsFirst: true,
			}),
			makePerspective({
				gameId: "g1",
				userId: "u2",
				deckTypeCode: "HERO_BEAT",
				winner: false,
				playerScore: 1,
				opponentScore: 2,
				g1IsFirst: false,
			}),
		];

		const result = DeckMatchupCalculator.calculate("1109", windowStart, top15Decks, perspectives);
		expect(result.admittedPhysicalMatches).toBe(1);
		expect(result.matchupRows).toHaveLength(1);
		expect(result.matchupRows[0]).toEqual({
			formatId: "1109",
			windowStart,
			firstDeckCode: "HERO_BEAT",
			secondDeckCode: "HERO_BEAT",
			matchCount: 1,
			firstWins: 1,
		});
	});

	it("skips match when G1 seat is null or unproven", () => {
		const perspectives = [
			makePerspective({
				gameId: "g1",
				userId: "u1",
				deckTypeCode: "HERO_BEAT",
				winner: true,
				playerScore: 2,
				opponentScore: 0,
				g1IsFirst: null, // G1 seat unknown!
			}),
			makePerspective({
				gameId: "g1",
				userId: "u2",
				deckTypeCode: "SIX_SAMURAI",
				winner: false,
				playerScore: 0,
				opponentScore: 2,
				g1IsFirst: null,
			}),
		];

		const result = DeckMatchupCalculator.calculate("1109", windowStart, top15Decks, perspectives);
		expect(result.admittedPhysicalMatches).toBe(0);
		expect(result.matchupRows).toHaveLength(0);
		expect(result.skipped.unprovenG1Seat).toBe(1);
	});

	it("skips match when one or both decks are not in Top 15 (e.g. OTHERS or rank 16)", () => {
		const perspectives = [
			makePerspective({
				gameId: "g1",
				userId: "u1",
				deckTypeCode: "HERO_BEAT", // Top 15
				winner: true,
				playerScore: 2,
				opponentScore: 0,
				g1IsFirst: true,
			}),
			makePerspective({
				gameId: "g1",
				userId: "u2",
				deckTypeCode: "OTHERS", // Not Top 15!
				winner: false,
				playerScore: 0,
				opponentScore: 2,
				g1IsFirst: false,
			}),
		];

		const result = DeckMatchupCalculator.calculate("1109", windowStart, top15Decks, perspectives);
		expect(result.admittedPhysicalMatches).toBe(0);
		expect(result.matchupRows).toHaveLength(0);
		expect(result.skipped.notTopDecks).toBe(1);
	});

	it("skips annulled or soft-deleted matches", () => {
		const perspectives = [
			makePerspective({
				gameId: "g1",
				userId: "u1",
				isAnnulled: true, // Annulled!
				g1IsFirst: true,
			}),
			makePerspective({
				gameId: "g1",
				userId: "u2",
				deckTypeCode: "SIX_SAMURAI",
				winner: false,
				playerScore: 0,
				opponentScore: 2,
				g1IsFirst: false,
			}),
		];

		const result = DeckMatchupCalculator.calculate("1109", windowStart, top15Decks, perspectives);
		expect(result.admittedPhysicalMatches).toBe(0);
		expect(result.skipped.annulledOrDeleted).toBe(1);
	});

	it("skips non-complementary results or single perspective", () => {
		// Single perspective only
		const singleResult = DeckMatchupCalculator.calculate("1109", windowStart, top15Decks, [
			makePerspective({ gameId: "g1", userId: "u1" }),
		]);
		expect(singleResult.admittedPhysicalMatches).toBe(0);
		expect(singleResult.skipped.invalidPerspectives).toBe(1);

		// Both winners (non-complementary)
		const bothWinnersResult = DeckMatchupCalculator.calculate("1109", windowStart, top15Decks, [
			makePerspective({ gameId: "g2", userId: "u1", winner: true }),
			makePerspective({
				gameId: "g2",
				userId: "u2",
				winner: true,
				deckTypeCode: "SIX_SAMURAI",
				g1IsFirst: false,
			}),
		]);
		expect(bothWinnersResult.admittedPhysicalMatches).toBe(0);
		expect(bothWinnersResult.skipped.nonComplementary).toBe(1);
	});

	it("guarantees sum of match_count in matchupRows equals admittedPhysicalMatches", () => {
		const perspectives = [
			// g1: HERO vs SIX
			makePerspective({
				gameId: "g1",
				userId: "u1",
				deckTypeCode: "HERO_BEAT",
				winner: true,
				playerScore: 2,
				opponentScore: 0,
				g1IsFirst: true,
			}),
			makePerspective({
				gameId: "g1",
				userId: "u2",
				deckTypeCode: "SIX_SAMURAI",
				winner: false,
				playerScore: 0,
				opponentScore: 2,
				g1IsFirst: false,
			}),
			// g2: HERO vs HERO (mirror)
			makePerspective({
				gameId: "g2",
				userId: "u3",
				deckTypeCode: "HERO_BEAT",
				winner: true,
				playerScore: 2,
				opponentScore: 1,
				g1IsFirst: true,
			}),
			makePerspective({
				gameId: "g2",
				userId: "u4",
				deckTypeCode: "HERO_BEAT",
				winner: false,
				playerScore: 1,
				opponentScore: 2,
				g1IsFirst: false,
			}),
			// g3: DARK_WORLD vs INZEKTOR
			makePerspective({
				gameId: "g3",
				userId: "u5",
				deckTypeCode: "DARK_WORLD",
				winner: false,
				playerScore: 0,
				opponentScore: 2,
				g1IsFirst: true,
			}),
			makePerspective({
				gameId: "g3",
				userId: "u6",
				deckTypeCode: "INZEKTOR",
				winner: true,
				playerScore: 2,
				opponentScore: 0,
				g1IsFirst: false,
			}),
		];

		const result = DeckMatchupCalculator.calculate("1109", windowStart, top15Decks, perspectives);
		expect(result.admittedPhysicalMatches).toBe(3);
		const sumMatchCount = result.matchupRows.reduce((acc, r) => acc + r.matchCount, 0);
		expect(sumMatchCount).toBe(result.admittedPhysicalMatches);
	});
});
