import { AbortMatchmakingRoom } from "@ygopro/matchmaking/application/AbortMatchmakingRoom";
import { YGOProClient } from "@ygopro/client/domain/YGOProClient";
import { DuelState } from "@shared/room/domain/YgoRoom";
import { ISocket } from "@shared/socket/domain/ISocket";

import { YGOProRoom } from "../domain/YGOProRoom";
import { FinalizeYGOProRoom } from "./FinalizeYGOProRoom";
import { YGOProRoomFinder } from "./YGOProRoomFinder";

export class YGOProDisconnectHandler {
	constructor(
		private readonly socket: ISocket,
		private readonly roomFinder: YGOProRoomFinder,
	) {}

	run(): void {
		if (!this.socket.id) {
			return;
		}

		const room = this.roomFinder.run(this.socket.id);
		if (!room) {
			return;
		}

		this.handle(room);
	}

	private handle(room: YGOProRoom): void {
		// A matchmaking reservation owns the whole two-player WAITING lobby. If
		// either socket leaves, close the room and release both queue identities;
		// the connected survivor will immediately re-enter the pool client-side.
		if (room.isMatchmaking && room.duelState === DuelState.WAITING) {
			AbortMatchmakingRoom.run(room);
			return;
		}

		// On `close` the leaver's socket is already closed, so this also catches
		// the last WAITING player leaving — finalize instead of leaking a zombie.
		if (room.hasNoConnectedPlayers) {
			FinalizeYGOProRoom.run(room);

			return;
		}

		const player = room.players.find((client) => client.socket.id === this.socket.id);

		if (!(player instanceof YGOProClient)) {
			this.removeSpectator(room);

			return;
		}

		// AI rooms have no second human host, so a single human leaving in ANY phase
		// must tear down the whole room — otherwise the orphaned bot lingers as a zombie.
		if (room.noHost) {
			FinalizeYGOProRoom.run(room);

			return;
		}

		if (room.duelState === DuelState.WAITING) {
			room.playerLeave(player);
			player.destroy();
		}
	}

	private removeSpectator(room: YGOProRoom): void {
		const spectator = room.spectators.find((client) => client.socket.id === this.socket.id);

		if (!(spectator instanceof YGOProClient)) {
			return;
		}

		room.spectatorLeave(spectator);
		spectator.destroy();
	}
}
