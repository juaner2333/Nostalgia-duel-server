import { generateUniqueId } from "src/utils/generateUniqueId";
import { config } from "src/config";
import { getActiveNostalgiaFormatIds, type NostalgiaFormatId } from "../../domain/NostalgiaFormat";
import type { NostalgiaFormatResourcePort } from "../../domain/NostalgiaFormatResourcePort";
import { YGOProRoom } from "../../domain/YGOProRoom";
import YGOProRoomList from "../../infrastructure/YGOProRoomList";
import { NostalgiaFormatResources } from "../../infrastructure/NostalgiaFormatResources";
import { JoinContext, JoinStrategy } from "./JoinStrategy";

const MAX_JOIN_GAME_PASS_LENGTH = 20;

export interface NostalgiaRoomId {
	formatId: NostalgiaFormatId;
	roomId: string;
}

export function isNostalgiaRoomInput(rawPass: string): boolean {
	return /^(?:1103|1109|goat)$|^(?:\d{4}|goat)#/.test(rawPass);
}

export function parseNostalgiaRoomId(rawPass: string): NostalgiaRoomId {
	if (rawPass.length > MAX_JOIN_GAME_PASS_LENGTH) {
		throw new Error("Nostalgia room ID exceeds the JoinGame protocol limit");
	}
	const parts = rawPass.split("#");
	if (parts.length !== 2) {
		throw new Error("Nostalgia room ID must contain exactly one format separator");
	}
	const [formatId, roomId] = parts;
	if (!getActiveNostalgiaFormatIds(config.resources.profile).some((id) => id === formatId)) {
		throw new Error(`Unsupported nostalgia format: ${formatId}`);
	}
	if (!/^\d+$/.test(roomId)) {
		throw new Error("Nostalgia room ID must be a non-empty decimal number");
	}
	return { formatId: formatId as NostalgiaFormatId, roomId };
}

export class NostalgiaJoinStrategy implements JoinStrategy {
	constructor(
		private readonly resources: NostalgiaFormatResourcePort = new NostalgiaFormatResources(),
	) {}

	matches(ctx: JoinContext): boolean {
		return isNostalgiaRoomInput(ctx.rawPass);
	}

	async handle(ctx: JoinContext): Promise<void> {
		const { formatId, roomId } = parseNostalgiaRoomId(ctx.rawPass);
		const admissionKey = `${formatId}#${roomId}`;
		let room = YGOProRoomList.findByAdmissionKey(admissionKey);

		if (!room) {
			const banListHash = this.resources.getBanListHash(formatId);
			if (banListHash === null) {
				throw new Error(`Nostalgia ban list is unavailable for format: ${formatId}`);
			}
			room = YGOProRoom.createNostalgia({
				id: generateUniqueId(),
				formatId,
				roomId,
				logger: ctx.logger,
				emitter: ctx.eventEmitter,
				createdBySocketId: ctx.socketId,
				messageRepository: ctx.messageRepository,
				banListHash,
			});
			YGOProRoomList.addRoom(room);
			room.waiting();
		}

		room.emit("JOIN", ctx.message, ctx.socket);
	}
}
