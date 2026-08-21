import type { YGOProRoom } from "../domain/YGOProRoom";
import YGOProRoomList from "./YGOProRoomList";

function room(id: number, admissionKey: string): YGOProRoom {
	return { id, admissionKey } as YGOProRoom;
}

describe("YGOProRoomList", () => {
	afterEach(() => {
		for (const item of [...YGOProRoomList.getRooms()]) {
			YGOProRoomList.deleteRoom(item);
		}
	});

	it("finds same-number rooms by the composite format key", () => {
		const room1103 = room(1, "1103#1001");
		const room1109 = room(2, "1109#1001");
		YGOProRoomList.addRoom(room1103);
		YGOProRoomList.addRoom(room1109);

		expect(YGOProRoomList.findByAdmissionKey("1103#1001")).toBe(room1103);
		expect(YGOProRoomList.findByAdmissionKey("1109#1001")).toBe(room1109);
		expect(YGOProRoomList.findByAdmissionKey("1103#1002")).toBeNull();
	});
});
