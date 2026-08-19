import { YGOProRoom } from "../domain/YGOProRoom";
import MercuryRoomList from "../infrastructure/YGOProRoomList";

export class YGOProRoomFinder {
	run(socketId: string): YGOProRoom | null {
		const rooms = MercuryRoomList.getRooms();
		for (const item of rooms) {
			const allClients = [...item.players, ...item.spectators];
			const found = allClients.find((client) => client.socket.id === socketId);
			if (found) {
				return item;
			}
		}

		return rooms.find((room) => room.createdBySocketId === socketId) ?? null;
	}
}
