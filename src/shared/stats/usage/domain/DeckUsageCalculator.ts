import { DECK_TYPE_CATALOG } from "@shared/deck/domain/classifier/DeckClassifier";

export interface PlayerMatchDeckSnapshot {
	readonly matchId: string;
	readonly formatId: string;
	readonly deckTypeCode: string;
	readonly mainCards: readonly number[];
	readonly extraCards: readonly number[];
	readonly sideCards: readonly number[] | null;
	readonly isAnnulled?: boolean;
	readonly isDeleted?: boolean;
}

export interface DeckUsageResult {
	readonly totalDecks: number;
	readonly sideKnownDecks: number;
	readonly deckCounts: ReadonlyMap<string, number>;
	readonly validSnapshots: readonly PlayerMatchDeckSnapshot[];
	readonly skippedCount: number;
}

export class DeckUsageCalculator {
	private readonly allowedCodes: ReadonlySet<string>;

	constructor(
		private readonly formatId: string,
		private readonly cardValidator?: (cardId: number) => boolean,
	) {
		const catalog = DECK_TYPE_CATALOG[formatId] ?? [];
		this.allowedCodes = new Set(catalog.map((c) => c.code));
	}

	public calculate(
		snapshots: readonly (PlayerMatchDeckSnapshot | null | undefined)[],
	): DeckUsageResult {
		let totalDecks = 0;
		let sideKnownDecks = 0;
		let skippedCount = 0;
		const deckCounts = new Map<string, number>();
		const validSnapshots: PlayerMatchDeckSnapshot[] = [];

		for (const snapshot of snapshots) {
			if (!snapshot) {
				skippedCount++;
				continue;
			}
			if (snapshot.isAnnulled || snapshot.isDeleted) {
				skippedCount++;
				continue;
			}
			if (snapshot.formatId !== this.formatId) {
				skippedCount++;
				continue;
			}
			if (
				!Array.isArray(snapshot.mainCards) ||
				snapshot.mainCards.length < 40 ||
				snapshot.mainCards.length > 60
			) {
				skippedCount++;
				continue;
			}
			if (!Array.isArray(snapshot.extraCards) || snapshot.extraCards.length > 15) {
				skippedCount++;
				continue;
			}
			if (
				snapshot.sideCards !== null &&
				(!Array.isArray(snapshot.sideCards) || snapshot.sideCards.length > 15)
			) {
				skippedCount++;
				continue;
			}
			if (!this.allowedCodes.has(snapshot.deckTypeCode)) {
				skippedCount++;
				continue;
			}
			if (this.cardValidator) {
				const hasInvalidCard =
					snapshot.mainCards.some((id) => !this.cardValidator!(id)) ||
					snapshot.extraCards.some((id) => !this.cardValidator!(id)) ||
					(snapshot.sideCards !== null &&
						snapshot.sideCards.some((id) => !this.cardValidator!(id)));
				if (hasInvalidCard) {
					skippedCount++;
					continue;
				}
			}

			// Valid credible snapshot
			totalDecks++;
			if (snapshot.sideCards !== null) {
				sideKnownDecks++;
			}
			deckCounts.set(snapshot.deckTypeCode, (deckCounts.get(snapshot.deckTypeCode) ?? 0) + 1);
			validSnapshots.push(snapshot);
		}

		return {
			totalDecks,
			sideKnownDecks,
			deckCounts,
			validSnapshots,
			skippedCount,
		};
	}
}
