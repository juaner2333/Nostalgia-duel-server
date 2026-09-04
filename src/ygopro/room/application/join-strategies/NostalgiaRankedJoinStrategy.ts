import { JoinContext, JoinStrategy } from "./JoinStrategy";
import {
	DirectNostalgiaRankedJoin,
	isRankedPass,
	isRankedSpectatorPass,
} from "../../ranked/application/DirectNostalgiaRankedJoin";
import { JoinRejectionError } from "../../domain/errors/JoinRejectionError";
import { AuthenticateOrRegisterPinUser } from "@shared/user-auth/application/AuthenticateOrRegisterPinUser";
import { UserProfilePostgresRepository } from "@shared/user-profile/infrastructure/postgres/UserProfilePostgresRepository";
import { RankedRoomRegistry } from "../../ranked/domain/RankedRoomRegistry";
import { NostalgiaFormatResources } from "../../infrastructure/NostalgiaFormatResources";
import { getNostalgiaFormat } from "../../domain/NostalgiaFormat";
import { DuelState } from "@shared/room/domain/YgoRoom";
import YGOProRoomList from "../../infrastructure/YGOProRoomList";
import { config } from "src/config";

export class NostalgiaRankedJoinStrategy implements JoinStrategy {
	constructor(private readonly directRankedJoin?: DirectNostalgiaRankedJoin) {}

	matches(ctx: JoinContext): boolean {
		return isRankedPass(ctx.rawPass);
	}

	async handle(ctx: JoinContext): Promise<void> {
		if (!config.ranking.enabled) {
			throw new JoinRejectionError("Ranked rooms are currently disabled", "排位功能当前未开启。");
		}

		if (isRankedSpectatorPass(ctx.rawPass)) {
			await this.handleSpectatorJoin(ctx);
			return;
		}

		const runner =
			this.directRankedJoin ??
			new DirectNostalgiaRankedJoin(
				new AuthenticateOrRegisterPinUser(new UserProfilePostgresRepository()),
				RankedRoomRegistry.getInstance(),
				new NostalgiaFormatResources(),
			);

		await runner.run(ctx);
	}

	private async handleSpectatorJoin(ctx: JoinContext): Promise<void> {
		if (ctx.rawPass.length > 20) {
			throw new Error("Ranked spectator pass exceeds the JoinGame protocol limit");
		}

		const formatId = ctx.rawPass.slice(0, 4);
		const spectatorIdStr = ctx.rawPass.slice(7);
		if (!getNostalgiaFormat(formatId)) {
			throw new Error(`Unsupported nostalgia format: ${formatId}`);
		}

		const spectatorId = parseInt(spectatorIdStr, 10);
		if (isNaN(spectatorId)) {
			throw new Error("Invalid spectator room ID");
		}

		const matchingRooms = YGOProRoomList.getRooms().filter((room) => {
			return (
				room.formatId === formatId &&
				room.isDirectRanked &&
				room.id === spectatorId &&
				!room.finalizing
			);
		});

		if (matchingRooms.length === 0) {
			throw new Error("Ranked room not found");
		}

		let targetRoom = matchingRooms.find((r) => r.duelState !== DuelState.WAITING);
		if (!targetRoom) {
			targetRoom = matchingRooms[0];
		}

		if (matchingRooms.length > 1) {
			ctx.logger.warn("Multiple ranked rooms matched spectator ID", {
				formatId,
				spectatorId,
				count: matchingRooms.length,
				chosenState: targetRoom.duelState,
			});
		}

		if (targetRoom.duelState === DuelState.WAITING) {
			throw new Error("Ranked room is waiting for matchmaking and cannot be spectated");
		}

		targetRoom.emit("JOIN", ctx.message, ctx.socket);
	}
}
