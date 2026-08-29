import { generateUniqueId } from "src/utils/generateUniqueId";
import { getNostalgiaFormat, type NostalgiaFormatId } from "../../domain/NostalgiaFormat";
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
	return rawPass === "1103" || rawPass === "1109" || /^\d{4}#/.test(rawPass);
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
	if (!getNostalgiaFormat(formatId)) {
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
				rankedOverride: ctx.socket.resolvedUserId ? true : undefined,
			});
			YGOProRoomList.addRoom(room);
			room.waiting();
		}

		room.emit("JOIN", ctx.message, ctx.socket, ctx.protocolVersion);
	}
}
