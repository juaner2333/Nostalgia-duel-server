import { RankedRoomRegistry } from "./RankedRoomRegistry";

describe("RankedRoomRegistry", () => {
	let registry: RankedRoomRegistry;

	beforeEach(() => {
		registry = new RankedRoomRegistry();
	});

	it("records and retrieves single room occupancy per user across formats", () => {
		expect(registry.getOccupancy("user-1")).toBeNull();

		registry.recordOccupancy("user-1", 100, "1103");
		const occupancy = registry.getOccupancy("user-1");

		expect(occupancy).toEqual({ roomId: 100, formatId: "1103" });
	});

	it("ensures a user cannot occupy two different rooms concurrently across formats", () => {
		registry.recordOccupancy("user-1", 100, "1103");
		// Recording new occupancy overwrites previous occupancy for the same user
		registry.recordOccupancy("user-1", 200, "1109");

		const occupancy = registry.getOccupancy("user-1");
		expect(occupancy).toEqual({ roomId: 200, formatId: "1109" });
	});

	it("tracks and manages pending seat reservations per room", () => {
		expect(registry.getReservations(100)).toBe(0);

		registry.reserveSeat(100);
		expect(registry.getReservations(100)).toBe(1);

		registry.reserveSeat(100);
		expect(registry.getReservations(100)).toBe(2);

		registry.releaseReservation(100);
		expect(registry.getReservations(100)).toBe(1);

		registry.releaseReservation(100);
		expect(registry.getReservations(100)).toBe(0);

		// Releasing below 0 is safe and stays at 0
		registry.releaseReservation(100);
		expect(registry.getReservations(100)).toBe(0);
	});

	it("releases occupancy idempotently by userId and by roomId", () => {
		registry.recordOccupancy("user-1", 100, "1103");
		registry.recordOccupancy("user-2", 100, "1103");
		registry.recordOccupancy("user-3", 200, "1109");

		registry.releaseOccupancy("user-1");
		expect(registry.getOccupancy("user-1")).toBeNull();
		expect(registry.getOccupancy("user-2")).toEqual({ roomId: 100, formatId: "1103" });

		// Releasing multiple times does not throw
		registry.releaseOccupancy("user-1");
		expect(registry.getOccupancy("user-1")).toBeNull();

		// Release all users occupying room 100
		registry.releaseRoomOccupancies(100);
		expect(registry.getOccupancy("user-2")).toBeNull();
		expect(registry.getOccupancy("user-3")).toEqual({ roomId: 200, formatId: "1109" });
	});
});
