import { Request, Response } from "express";

import { cardRepositories } from "../composition/CardRepositories";

export class GetDatabasesController {
	async run(_request: Request, response: Response): Promise<void> {
		const ygopro = await cardRepositories.ygopro.listSources();

		response.status(200).json({ ygopro });
	}
}
