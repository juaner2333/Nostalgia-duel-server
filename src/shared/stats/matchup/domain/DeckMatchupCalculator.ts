export interface RawPhysicalMatchPerspective {
	readonly gameId: string;
	readonly matchId: string;
	readonly userId: string;
	readonly formatId: string;
	readonly winner: boolean;
	readonly playerScore: number;
	readonly opponentScore: number;
	readonly isAnnulled?: boolean;
	readonly isDeleted?: boolean;
	readonly deckTypeCode: string | null;
	readonly g1IsFirst: boolean | null;
}

export interface DeckMatchupRowData {
	readonly formatId: string;
	readonly windowStart: string;
	readonly firstDeckCode: string;
	readonly secondDeckCode: string;
	readonly matchCount: number;
	readonly firstWins: number;
}

export interface DeckMatchupCalculationResult {
	readonly totalPhysicalMatches: number;
	readonly admittedPhysicalMatches: number;
	readonly matchupRows: readonly DeckMatchupRowData[];
	readonly skipped: {
		invalidPerspectives: number;
		notTopDecks: number;
		unprovenG1Seat: number;
		annulledOrDeleted: number;
		nonComplementary: number;
	};
}

export class DeckMatchupCalculator {
	public static calculate(
		formatId: string,
		windowStart: string,
		topDeckCodes: readonly string[],
		perspectives: readonly RawPhysicalMatchPerspective[],
	): DeckMatchupCalculationResult {
		const skipped = {
			invalidPerspectives: 0,
			notTopDecks: 0,
			unprovenG1Seat: 0,
			annulledOrDeleted: 0,
			nonComplementary: 0,
		};

		if (formatId !== "1109") {
			return {
				totalPhysicalMatches: 0,
				admittedPhysicalMatches: 0,
				matchupRows: [],
				skipped,
			};
		}

		const topDeckCodesSet = new Set(topDeckCodes);

		// Group perspectives by gameId
		const grouped = new Map<string, RawPhysicalMatchPerspective[]>();
		for (const p of perspectives) {
			const list = grouped.get(p.gameId);
			if (list) {
				list.push(p);
			} else {
				grouped.set(p.gameId, [p]);
			}
		}

		let admittedPhysicalMatches = 0;
		// Map of `${firstDeckCode}::${secondDeckCode}` -> { matchCount, firstWins }
		const matchupMap = new Map<string, { matchCount: number; firstWins: number }>();

		for (const [, rows] of grouped) {
			// 1. Check annulled / deleted
			if (rows.some((r) => r.isAnnulled || r.isDeleted)) {
				skipped.annulledOrDeleted++;
				continue;
			}

			// 2. Exactly 2 perspectives and distinct user IDs
			if (rows.length !== 2 || rows[0].userId === rows[1].userId) {
				skipped.invalidPerspectives++;
				continue;
			}

			const [m1, m2] = rows;

			// 3. Format must be 1109
			if (m1.formatId !== "1109" || m2.formatId !== "1109") {
				continue;
			}

			// 4. Complementary match outcomes
			const complementary =
				m1.winner !== m2.winner &&
				m1.playerScore === m2.opponentScore &&
				m1.opponentScore === m2.playerScore;
			if (!complementary) {
				skipped.nonComplementary++;
				continue;
			}

			// 5. Deck classifications must be present and in the selected Top decks
			const deck1 = m1.deckTypeCode;
			const deck2 = m2.deckTypeCode;
			if (!deck1 || !deck2 || !topDeckCodesSet.has(deck1) || !topDeckCodesSet.has(deck2)) {
				skipped.notTopDecks++;
				continue;
			}

			// 6. G1 seat must be proven and complementary
			if (m1.g1IsFirst === null || m2.g1IsFirst === null || m1.g1IsFirst === m2.g1IsFirst) {
				skipped.unprovenG1Seat++;
				continue;
			}

			// 7. Determine first and second player
			const firstPlayer = m1.g1IsFirst === true ? m1 : m2;
			const secondPlayer = m1.g1IsFirst === true ? m2 : m1;
			const firstDeckCode = firstPlayer.deckTypeCode!;
			const secondDeckCode = secondPlayer.deckTypeCode!;
			const firstWon = firstPlayer.winner === true;

			const key = `${firstDeckCode}::${secondDeckCode}`;
			const existing = matchupMap.get(key) ?? { matchCount: 0, firstWins: 0 };
			existing.matchCount += 1;
			if (firstWon) {
				existing.firstWins += 1;
			}
			matchupMap.set(key, existing);

			admittedPhysicalMatches += 1;
		}

		// Convert to sorted array of DeckMatchupRowData
		const matchupRows: DeckMatchupRowData[] = [];
		for (const [key, val] of matchupMap.entries()) {
			const [firstDeckCode, secondDeckCode] = key.split("::");
			matchupRows.push({
				formatId,
				windowStart,
				firstDeckCode,
				secondDeckCode,
				matchCount: val.matchCount,
				firstWins: val.firstWins,
			});
		}

		matchupRows.sort((a, b) => {
			if (a.firstDeckCode !== b.firstDeckCode) {
				return a.firstDeckCode.localeCompare(b.firstDeckCode);
			}
			return a.secondDeckCode.localeCompare(b.secondDeckCode);
		});

		return {
			totalPhysicalMatches: grouped.size,
			admittedPhysicalMatches,
			matchupRows,
			skipped,
		};
	}
}
