import { CdbCardSearchRepository } from "@shared/card/infrastructure/cdb/CdbCardSearchRepository";
import { YGOProCardSearchRepository } from "@ygopro/card/infrastructure/YGOProCardSearchRepository";

export const cardRepositories: { ygopro: CdbCardSearchRepository } = {
	ygopro: new YGOProCardSearchRepository(),
};

export type CardEngine = "ygopro";

export const isCardEngine = (value: unknown): value is CardEngine => value === "ygopro";
