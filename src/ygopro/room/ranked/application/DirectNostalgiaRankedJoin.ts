import { generateUniqueId } from "src/utils/generateUniqueId";
import { AuthenticateOrRegisterPinUser } from "@shared/user-auth/application/AuthenticateOrRegisterPinUser";
import { AuthFailureReason, type AuthResult } from "@shared/user-auth/domain/AuthResult";
import { JoinRejectionError } from "../../domain/errors/JoinRejectionError";
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

export const RANKED_FORMAT_CLIENT_ERROR =
	"排位登录格式错误：请将玩家名填写为“昵称$4位数字PIN”，完整内容不能超过20个字符（例如：玩家$1234）。";

export function validateRankedPlayerFormat(raw: string): { name: string; pin: string } {
	if (raw.length > 20) {
		throw new JoinRejectionError(
			`Ranked player info exceeds 20 characters limit (${raw.length} chars)`,
			RANKED_FORMAT_CLIENT_ERROR,
		);
	}

	if (!raw.includes("$")) {
		throw new JoinRejectionError(
			"Ranked player info is missing $ delimiter",
			RANKED_FORMAT_CLIENT_ERROR,
		);
	}

	const parts = raw.split("$");
	if (parts.length > 2) {
		throw new JoinRejectionError(
			"Ranked player info contains multiple $ delimiters",
			RANKED_FORMAT_CLIENT_ERROR,
		);
	}

	const [name, pin] = parts;
	if (!name || name.trim().length === 0) {
		throw new JoinRejectionError(
			"Ranked player info has empty nickname",
			RANKED_FORMAT_CLIENT_ERROR,
		);
	}

	if (name.includes(":")) {
		throw new JoinRejectionError(
			"Ranked player nickname contains invalid colon delimiter",
			RANKED_FORMAT_CLIENT_ERROR,
		);
	}

	if (!/^\d{4}$/.test(pin)) {
		const isTruncated = raw.length === 20 && pin.length < 4;
		const reason = isTruncated
			? "Ranked player name too long; PIN was truncated at 20 characters"
			: !/^\d+$/.test(pin)
				? "Ranked PIN contains non-digit characters"
				: `Ranked PIN must be exactly 4 digits (received ${pin.length} digits)`;
		throw new JoinRejectionError(reason, RANKED_FORMAT_CLIENT_ERROR);
	}

	return { name, pin };
}

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

		const rawInput =
			ctx.playerInfo.raw !== undefined && ctx.playerInfo.raw !== ""
				? ctx.playerInfo.raw
				: ctx.playerInfo.rankedPin
					? `${ctx.playerInfo.name}$${ctx.playerInfo.rankedPin}`
					: ctx.playerInfo.name;

		const { name, pin } = validateRankedPlayerFormat(rawInput);

		let authResult: AuthResult;
		try {
			authResult = await this.authUseCase.run({
				name,
				pin,
			});
		} catch (error) {
			throw new JoinRejectionError(
				`Ranked authentication failed due to database or unexpected error: ${error instanceof Error ? error.message : String(error)}`,
				"排位账号认证失败，请稍后重试。",
			);
		}

		if (!authResult.ok) {
			switch (authResult.reason) {
				case AuthFailureReason.INVALID_PASSWORD:
					throw new JoinRejectionError(
						"Ranked authentication failed: invalid PIN",
						"排位密码错误：请输入该昵称对应的4位数字PIN。",
					);
				case AuthFailureReason.USER_BANNED:
					throw new JoinRejectionError(
						"Ranked authentication failed: user banned",
						"该排位账号已被封禁，如有疑问请联系管理员。",
					);
				case AuthFailureReason.USER_NOT_FOUND:
				default:
					throw new JoinRejectionError(
						`Ranked authentication failed: ${authResult.reason}`,
						"排位账号认证失败，请稍后重试。",
					);
			}
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
					throw new JoinRejectionError(
						`User is currently occupied in format ${existingOccupancy.formatId} and cannot join ${targetFormat}`,
						`你已加入 ${existingOccupancy.formatId} 排位，无法同时加入 ${targetFormat} 排位。`,
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
					throw new JoinRejectionError(
						`Nostalgia ban list is unavailable for format: ${targetFormat}`,
						"排位房间暂时不可用，请稍后重试。",
					);
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
