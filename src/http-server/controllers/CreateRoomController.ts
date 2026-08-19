import { Request, Response } from "express";

import { Logger } from "../../shared/logger/domain/Logger";

// The HTTP room-creation endpoint only ever created EDOPro rooms via the
// EDOPro RoomCreator. With EDOPro support removed the endpoint reports
// unavailability instead of creating anything; YGOPro rooms are created
// through the YGOPro client join flow.
export class CreateRoomController {
	constructor(private readonly logger: Logger) {}

	run(_req: Request, res: Response): void {
		this.logger.warn("POST /api/room rejected — EDOPro room creation is no longer supported");
		res.status(501).json({
			success: false,
			errors: [
				{
					code: "unsupported",
					message: "EDOPro room creation is no longer supported",
				},
			],
		});
	}
}
