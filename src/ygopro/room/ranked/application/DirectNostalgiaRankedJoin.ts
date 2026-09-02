import { generateUniqueId } from "src/utils/generateUniqueId";
import { AuthenticateOrRegisterPinUser } from "@shared/user-auth/application/AuthenticateOrRegisterPinUser";
import { NostalgiaFormatResourcePort } from "../../domain/NostalgiaFormatResourcePort";
import { NostalgiaFormatResources } from "../../infrastructure/NostalgiaFormatResources";
import { getNostalgiaFormat, type NostalgiaFormatId } from "../../domain/NostalgiaFormat";
import { YGOProRoom } from "../../domain/YGOProRoom";
import YGOProRoomList from "../../infrastructure/YGOProRoomList";
import { RankedRoomRegistry } from "../domain/RankedRoomRegistry";
import { JoinContext } from "../../application/join-strategies/JoinStrategy";
import { DuelState } from "@shared/room/domain/YgoRoom";
import { ISocket } from "@shared/socket/domain/ISocket";

import { ChatColor, YGOProStocChat } from "ygopro-msg-encode";
import { calculateBeijingSeason } from "src/utils/calculateBeijingSeason";
import { LeaderboardRepository } from "@shared/stats/leaderboard/domain/LeaderboardRepository";
import { LeaderboardPostgresRepository } from "@shared/stats/leaderboard/infrastructure/postgres/LeaderboardPostgresRepository";

import { EventBus } from "@shared/event-bus/EventBus";
import { container } from "@shared/dependency-injection";

export function parseRankedPass(rawPass: string): NostalgiaFormatId {
	if (rawPass === "TT") {
		return "1109";
	}
	const match = /^(\d{4})#TT$/.exec(rawPass);
	if (!match) {
		throw new Error("Invalid ranked room identifier");
	}
	const formatId = match[1];
	if (!getNostalgiaFormat(formatId)) {
		throw new Error(`Unsupported nostalgia format: ${formatId}`);
	}
	return formatId as NostalgiaFormatId;
}

export function isRankedSpectatorPass(rawPass: string): boolean {
	return /^\d{4}#TT\d+$/.test(rawPass);
}

export function isRankedPass(rawPass: string): boolean {
	return rawPass === "TT" || /^\d{4}#TT$/.test(rawPass) || isRankedSpectatorPass(rawPass);
}

export class DirectNostalgiaRankedJoin {
	constructor(
		private readonly authUseCase: AuthenticateOrRegisterPinUser,
		private readonly rankedRoomRegistry: RankedRoomRegistry = RankedRoomRegistry.getInstance(),
		private readonly resources: NostalgiaFormatResourcePort = new NostalgiaFormatResources(),
		private readonly leaderboardRepository: LeaderboardRepository = new LeaderboardPostgresRepository(),
		private readonly eventBus?: EventBus,
	) {}

	async run(ctx: JoinContext): Promise<YGOProRoom> {
		const targetFormat = parseRankedPass(ctx.rawPass);

		if (!ctx.playerInfo.rankedPin) {
			throw new Error("Ranked join requires a valid nickname and 4-digit PIN");
		}

		const authResult = await this.authUseCase.run({
			name: ctx.playerInfo.name,
			pin: ctx.playerInfo.rankedPin,
		});

		if (!authResult.ok) {
			throw new Error(`Authentication failed: ${authResult.reason}`);
		}

		const user = authResult.profile;
		ctx.socket.resolvedUserId = user.id;

		const existingOccupancy = this.rankedRoomRegistry.getOccupancy(user.id);
		let targetRoom: YGOProRoom | null = null;
		let isRecovering = false;

		if (existingOccupancy) {
			const existingRoom = YGOProRoomList.findById(existingOccupancy.roomId);
			if (existingRoom && !existingRoom.finalizing) {
				if (ctx.rawPass !== "TT" && existingOccupancy.formatId !== targetFormat) {
					throw new Error(
						`User is currently occupied in format ${existingOccupancy.formatId} and cannot join ${targetFormat}`,
					);
				}
				targetRoom = existingRoom;
				isRecovering = true;
			} else {
				this.rankedRoomRegistry.releaseOccupancy(user.id);
			}
		}

		if (!targetRoom) {
			const availableRoom = YGOProRoomList.getRooms().find((room) => {
				if (room.formatId !== targetFormat) return false;
				if (!room.isDirectRanked) return false;
				if (room.duelState !== DuelState.WAITING) return false;
				if (room.finalizing) return false;
				const currentCount = Math.max(
					room.players.length,
					this.rankedRoomRegistry.getReservations(room.id),
				);
				return currentCount < 2;
			});

			if (availableRoom) {
				targetRoom = availableRoom;
				this.rankedRoomRegistry.reserveSeat(targetRoom.id);
			} else {
				const banListHash = this.resources.getBanListHash(targetFormat);
				if (banListHash === null) {
					throw new Error(`Nostalgia ban list is unavailable for format: ${targetFormat}`);
				}
				const bus = this.eventBus ?? (container ? container.get(EventBus) : undefined);
				targetRoom = YGOProRoom.createDirectRanked({
					id: generateUniqueId(),
					formatId: targetFormat,
					logger: ctx.logger,
					emitter: ctx.eventEmitter,
					createdBySocketId: ctx.socketId,
					messageRepository: ctx.messageRepository,
					banListHash,
					eventBus: bus,
				});
				YGOProRoomList.addRoom(targetRoom);
				targetRoom.waiting();
				this.rankedRoomRegistry.reserveSeat(targetRoom.id);
			}
		}

		try {
			if (!isRecovering) {
				this.rankedRoomRegistry.recordOccupancy(user.id, targetRoom.id, targetFormat);
			}
			targetRoom.emit("JOIN", ctx.message, ctx.socket);
			void this.sendRankedNotice(ctx.socket, user.id, targetRoom.formatId);
		} catch (error) {
			if (!isRecovering && targetRoom) {
				this.rankedRoomRegistry.releaseReservation(targetRoom.id);
				this.rankedRoomRegistry.releaseOccupancy(user.id);
			}
			throw error;
		}

		return targetRoom;
	}

	private async sendRankedNotice(socket: ISocket, userId: string, formatId: string): Promise<void> {
		try {
			const beijingSeason = calculateBeijingSeason(new Date());
			const stats = await this.leaderboardRepository.getPlayerMonthlyStats(
				userId,
				formatId,
				beijingSeason,
			);
			const winRatePct = (stats.winRate * 100).toFixed(1);
			const rankStr = stats.rank !== null ? `#${stats.rank}` : "未上榜";
			const msg = `[排位] ${stats.format} ${stats.season} 赛季战绩: ${stats.points} 分 | ${stats.wins}胜 ${stats.losses}负 (${winRatePct}%) | 排名: ${rankStr}`;

			const chat = new YGOProStocChat().fromPartial({
				player_type: ChatColor.LIGHTBLUE,
				msg,
			});
			socket.send(Buffer.from(chat.toFullPayload()));
		} catch {
			// ignore if stats cannot be retrieved
		}
	}
}
