import { Request, Response } from "express";

import YGOProRoomList from "@ygopro/room/infrastructure/YGOProRoomList";

export class GetRoomListController {
	run(_req: Request, response: Response): void {
		const rooms = YGOProRoomList.getRooms().map((room) => room.toPresentation());
		response.status(200).json({ rooms });
	}
}
