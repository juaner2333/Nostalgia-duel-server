export type PlayerDeckSnapshot = {
	readonly mainCards: readonly number[];
	readonly extraCards: readonly number[];
	readonly sideCards: readonly number[] | null;
};
