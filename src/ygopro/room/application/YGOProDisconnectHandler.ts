import { YGOProClient } from "@ygopro/client/domain/YGOProClient";
import { DuelState } from "@shared/room/domain/YgoRoom";
import { ISocket } from "@shared/socket/domain/ISocket";

import { YGOProRoom } from "../domain/YGOProRoom";
import { FinalizeYGOProRoom } from "./FinalizeYGOProRoom";
import { YGOProRoomFinder } from "./YGOProRoomFinder";
import { RankedRoomRegistry } from "../ranked/domain/RankedRoomRegistry";

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
			if (player.id) {
				RankedRoomRegistry.getInstance().releaseOccupancy(player.id);
			}
			room.playerLeave(player);
			player.destroy();
			if (room.hasNoConnectedPlayers) {
				FinalizeYGOProRoom.run(room);
			}
			return;
		}

		if (room.isDirectRanked) {
			room.startPlayerDisconnectTimer(player, () => {
				if (room.finalizing) return;
				const otherPlayer = room.players.find((p) => p !== player && !p.socket.closed);
				if (otherPlayer instanceof YGOProClient) {
					room.forfeitMatch(player);
				}
				FinalizeYGOProRoom.run(room);
			});
		}

		if (room.hasNoConnectedPlayers) {
			room.startReconnectGrace(() => FinalizeYGOProRoom.run(room));
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
