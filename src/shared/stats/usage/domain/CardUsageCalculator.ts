import { CardTypes } from "@shared/card/domain/CardTypes";
import { PlayerMatchDeckSnapshot } from "./DeckUsageCalculator";

export type CardMetric = "monster" | "spell" | "trap" | "extra" | "side";

export interface CardMetadata {
	readonly id: number;
	readonly alias: number;
	readonly type: number;
	readonly name: string;
}

export interface CardMetadataProvider {
	getCardMetadata(cardId: number): CardMetadata | undefined;
	getCanonicalCardId(cardId: number): number;
}

export interface CardUsageRow {
	readonly formatId: string;
	readonly windowStart: string;
	readonly metric: CardMetric;
	readonly cardId: number;
	readonly deckCount: number;
	readonly copies1: number;
	readonly copies2: number;
	readonly copies3: number;
}

export class CardUsageCalculator {
	constructor(
		private readonly metadataProvider: CardMetadataProvider,
		private readonly formatId: string,
		private readonly windowStart: string,
	) {}

	public calculate(snapshots: readonly PlayerMatchDeckSnapshot[]): CardUsageRow[] {
		const accumulator = new Map<
			string,
			{
				formatId: string;
				windowStart: string;
				metric: CardMetric;
				cardId: number;
				deckCount: number;
				copies1: number;
				copies2: number;
				copies3: number;
			}
		>();

		for (const snapshot of snapshots) {
			if (snapshot.formatId !== this.formatId) {
				continue;
			}

			// 1. Main cards
			const mainCounts = new Map<number, number>();
			for (const cardId of snapshot.mainCards) {
				const canonId = this.metadataProvider.getCanonicalCardId(cardId);
				mainCounts.set(canonId, (mainCounts.get(canonId) ?? 0) + 1);
			}
			for (const [canonId, count] of mainCounts.entries()) {
				const meta = this.metadataProvider.getCardMetadata(canonId);
				if (!meta) continue;
				const metric = this.resolveMainMetric(meta.type);
				if (!metric) continue;
				this.record(accumulator, metric, canonId, count);
			}

			// 2. Extra cards
			const extraCounts = new Map<number, number>();
			for (const cardId of snapshot.extraCards) {
				const canonId = this.metadataProvider.getCanonicalCardId(cardId);
				extraCounts.set(canonId, (extraCounts.get(canonId) ?? 0) + 1);
			}
			for (const [canonId, count] of extraCounts.entries()) {
				this.record(accumulator, "extra", canonId, count);
			}

			// 3. Side cards (only if sideCards is not null)
			if (snapshot.sideCards !== null) {
				const sideCounts = new Map<number, number>();
				for (const cardId of snapshot.sideCards) {
					const canonId = this.metadataProvider.getCanonicalCardId(cardId);
					sideCounts.set(canonId, (sideCounts.get(canonId) ?? 0) + 1);
				}
				for (const [canonId, count] of sideCounts.entries()) {
					this.record(accumulator, "side", canonId, count);
				}
			}
		}

		return Array.from(accumulator.values());
	}

	private resolveMainMetric(type: number): "monster" | "spell" | "trap" | undefined {
		if ((type & CardTypes.TYPE_MONSTER) !== 0) {
			return "monster";
		}
		if ((type & CardTypes.TYPE_SPELL) !== 0) {
			return "spell";
		}
		if ((type & CardTypes.TYPE_TRAP) !== 0) {
			return "trap";
		}
		return undefined;
	}

	private record(
		acc: Map<
			string,
			{
				formatId: string;
				windowStart: string;
				metric: CardMetric;
				cardId: number;
				deckCount: number;
				copies1: number;
				copies2: number;
				copies3: number;
			}
		>,
		metric: CardMetric,
		cardId: number,
		count: number,
	): void {
		const key = `${metric}:${cardId}`;
		let entry = acc.get(key);
		if (!entry) {
			entry = {
				formatId: this.formatId,
				windowStart: this.windowStart,
				metric,
				cardId,
				deckCount: 0,
				copies1: 0,
				copies2: 0,
				copies3: 0,
			};
			acc.set(key, entry);
		}
		entry.deckCount += 1;
		if (count === 1) {
			entry.copies1 += 1;
		} else if (count === 2) {
			entry.copies2 += 1;
		} else {
			entry.copies3 += 1;
		}
	}
}
