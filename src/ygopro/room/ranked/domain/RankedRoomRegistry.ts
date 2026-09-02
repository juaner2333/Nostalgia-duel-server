import { NostalgiaFormatId } from "../../domain/NostalgiaFormat";

export type UserOccupancy = {
	readonly roomId: number;
	readonly formatId: NostalgiaFormatId;
};

export class RankedRoomRegistry {
	private static instance: RankedRoomRegistry | null = null;
	private readonly occupancies: Map<string, UserOccupancy> = new Map();
	private readonly reservations: Map<number, number> = new Map();

	static getInstance(): RankedRoomRegistry {
		if (!RankedRoomRegistry.instance) {
			RankedRoomRegistry.instance = new RankedRoomRegistry();
		}
		return RankedRoomRegistry.instance;
	}

	getOccupancy(userId: string): UserOccupancy | null {
		return this.occupancies.get(userId) ?? null;
	}

	recordOccupancy(userId: string, roomId: number, formatId: NostalgiaFormatId): void {
		this.occupancies.set(userId, { roomId, formatId });
	}

	releaseOccupancy(userId: string): void {
		this.occupancies.delete(userId);
	}

	releaseRoomOccupancies(roomId: number): void {
		for (const [userId, occupancy] of this.occupancies.entries()) {
			if (occupancy.roomId === roomId) {
				this.occupancies.delete(userId);
			}
		}
		this.reservations.delete(roomId);
	}

	getReservations(roomId: number): number {
		return this.reservations.get(roomId) ?? 0;
	}

	reserveSeat(roomId: number): void {
		const current = this.getReservations(roomId);
		this.reservations.set(roomId, current + 1);
	}

	releaseReservation(roomId: number): void {
		const current = this.getReservations(roomId);
		if (current <= 1) {
			this.reservations.delete(roomId);
		} else {
			this.reservations.set(roomId, current - 1);
		}
	}

	clear(): void {
		this.occupancies.clear();
		this.reservations.clear();
	}
}
