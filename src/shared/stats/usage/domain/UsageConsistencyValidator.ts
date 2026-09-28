import { DECK_TYPE_CATALOG } from "@shared/deck/domain/classifier/DeckClassifier";
import { CardUsageRow } from "./CardUsageCalculator";
import { CdbCardMetadataProvider } from "../infrastructure/cdb/CdbCardMetadataProvider";
import { DeckMatchupRowData } from "@shared/stats/matchup/domain/DeckMatchupCalculator";

export interface UsageStatRunData {
	readonly formatId: string;
	readonly windowStart: string;
	readonly windowEndExclusive: string;
	readonly dataEndExclusive: string;
	readonly totalDecks: number;
	readonly sideKnownDecks: number;
	readonly publishedAt: Date;
}

export interface UsageDeckRowData {
	readonly formatId: string;
	readonly windowStart: string;
	readonly deckTypeCode: string;
	readonly deckCount: number;
}

export class UsageConsistencyValidator {
	public static validate(
		run: UsageStatRunData,
		deckRows: readonly UsageDeckRowData[],
		cardRows: readonly CardUsageRow[],
		metadataProvider?: CdbCardMetadataProvider,
	): void {
		// 1. Format ID check
		if (run.formatId !== "1103" && run.formatId !== "1109") {
			throw new Error(`Invalid formatId: ${run.formatId}`);
		}

		// 2. Denominator check
		if (run.totalDecks < 0) {
			throw new Error(`totalDecks cannot be negative: ${run.totalDecks}`);
		}
		if (run.sideKnownDecks < 0 || run.sideKnownDecks > run.totalDecks) {
			throw new Error(
				`Invalid sideKnownDecks: ${run.sideKnownDecks} (totalDecks: ${run.totalDecks})`,
			);
		}

		// 3. Deck rows check
		const catalog = DECK_TYPE_CATALOG[run.formatId] ?? [];
		const allowedCodes = new Set(catalog.map((c) => c.code));

		let sumDeckCount = 0;
		for (const row of deckRows) {
			if (row.formatId !== run.formatId) {
				throw new Error(`Deck row formatId mismatch: ${row.formatId} !== ${run.formatId}`);
			}
			if (row.windowStart !== run.windowStart) {
				throw new Error(`Deck row windowStart mismatch: ${row.windowStart} !== ${run.windowStart}`);
			}
			if (!allowedCodes.has(row.deckTypeCode)) {
				throw new Error(`Deck type code ${row.deckTypeCode} not allowed in format ${run.formatId}`);
			}
			if (row.deckCount <= 0) {
				throw new Error(`deckCount must be positive: ${row.deckCount}`);
			}
			sumDeckCount += row.deckCount;
		}

		if (sumDeckCount !== run.totalDecks) {
			throw new Error(
				`Sum of deck row counts (${sumDeckCount}) does not match totalDecks (${run.totalDecks})`,
			);
		}

		// 4. Card rows check
		for (const card of cardRows) {
			if (card.formatId !== run.formatId) {
				throw new Error(`Card row formatId mismatch: ${card.formatId} !== ${run.formatId}`);
			}
			if (card.windowStart !== run.windowStart) {
				throw new Error(
					`Card row windowStart mismatch: ${card.windowStart} !== ${run.windowStart}`,
				);
			}
			if (card.deckCount <= 0) {
				throw new Error(`card deckCount must be positive: ${card.deckCount}`);
			}
			if (card.copies1 < 0 || card.copies2 < 0 || card.copies3 < 0) {
				throw new Error(`copies count cannot be negative`);
			}
			if (card.copies1 + card.copies2 + card.copies3 !== card.deckCount) {
				throw new Error(
					`copies sum (${card.copies1}+${card.copies2}+${card.copies3}) != deckCount (${card.deckCount}) for card ${card.cardId}`,
				);
			}

			// Upper bound against denominator
			if (card.metric === "side") {
				if (card.deckCount > run.sideKnownDecks) {
					throw new Error(
						`Side card ${card.cardId} count (${card.deckCount}) exceeds sideKnownDecks (${run.sideKnownDecks})`,
					);
				}
			} else {
				if (card.deckCount > run.totalDecks) {
					throw new Error(
						`Card ${card.cardId} count (${card.deckCount}) exceeds totalDecks (${run.totalDecks})`,
					);
				}
			}

			if (metadataProvider && !metadataProvider.hasCard(card.cardId)) {
				throw new Error(`Card ${card.cardId} does not exist in fixed resource CDB`);
			}
		}
	}

	public static validateMatchupRows(
		formatId: string,
		windowStart: string,
		matchupRows: readonly DeckMatchupRowData[],
		expectedAdmittedMatches: number,
		topDeckCodes: readonly string[],
	): void {
		if (formatId === "1103") {
			if (matchupRows.length > 0 || expectedAdmittedMatches > 0) {
				throw new Error("Format 1103 must not have matchup rows");
			}
			return;
		}

		if (formatId !== "1109") {
			throw new Error(`Unsupported format for matchups: ${formatId}`);
		}

		const topDeckCodesSet = new Set(topDeckCodes);
		let sumMatchCount = 0;
		const seenKeys = new Set<string>();

		for (const row of matchupRows) {
			if (row.formatId !== "1109") {
				throw new Error(`Matchup row formatId mismatch: ${row.formatId} !== 1109`);
			}
			if (row.windowStart !== windowStart) {
				throw new Error(`Matchup row windowStart mismatch: ${row.windowStart} !== ${windowStart}`);
			}
			if (row.firstDeckCode === "OTHERS" || row.secondDeckCode === "OTHERS") {
				throw new Error("Matchup rows cannot contain OTHERS");
			}
			if (!topDeckCodesSet.has(row.firstDeckCode)) {
				throw new Error(`firstDeckCode ${row.firstDeckCode} is not in top 15 decks`);
			}
			if (!topDeckCodesSet.has(row.secondDeckCode)) {
				throw new Error(`secondDeckCode ${row.secondDeckCode} is not in top 15 decks`);
			}
			if (row.matchCount <= 0) {
				throw new Error(`matchCount must be positive, got ${row.matchCount}`);
			}
			if (row.firstWins < 0 || row.firstWins > row.matchCount) {
				throw new Error(
					`firstWins must be between 0 and matchCount (${row.matchCount}), got ${row.firstWins}`,
				);
			}

			const key = `${row.firstDeckCode}::${row.secondDeckCode}`;
			if (seenKeys.has(key)) {
				throw new Error(`Duplicate matchup row for key: ${key}`);
			}
			seenKeys.add(key);

			sumMatchCount += row.matchCount;
		}

		if (sumMatchCount !== expectedAdmittedMatches) {
			throw new Error(
				`Sum of matchup match_count (${sumMatchCount}) does not match admittedPhysicalMatches (${expectedAdmittedMatches})`,
			);
		}
	}
}
