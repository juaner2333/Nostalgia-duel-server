import { randomInt } from "crypto";
import { EventEmitter } from "stream";

import { Logger } from "@shared/logger/domain/Logger";
import { generateUniqueId } from "src/utils/generateUniqueId";

import { MatchmakingFormat } from "@ygopro/matchmaking/domain/QueueEntry";
import type { NostalgiaFormatResourcePort } from "@ygopro/room/domain/NostalgiaFormatResourcePort";
import { YGOProRoom } from "@ygopro/room/domain/YGOProRoom";
import { YGOProMessageRepository } from "@ygopro/room/infrastructure/YGOProMessageRepository";
import { NostalgiaFormatResources } from "@ygopro/room/infrastructure/NostalgiaFormatResources";
import YGOProRoomList from "@ygopro/room/infrastructure/YGOProRoomList";

export interface CreateMatchmakingRoomInput {
	format: MatchmakingFormat;
	rankedOverride: boolean;
	logger: Logger;
	emitter: EventEmitter;
	resources?: NostalgiaFormatResourcePort;
	onRoomCreated?: (room: YGOProRoom) => void;
}

export interface MatchmakingRoomHandle {
	room: YGOProRoom;
	/** The exact fixed-format room identifier sent in CTOS_JOIN_GAME { pass }. */
	roomPassword: string;
}

const MIN_ROOM_ID = 1_000_000_000_000;
const MAX_ROOM_ID = 10_000_000_000_000;

function createExternalRoomId(): string {
	return randomInt(MIN_ROOM_ID, MAX_ROOM_ID).toString();
}

export function createMatchmakingRoom(input: CreateMatchmakingRoomInput): MatchmakingRoomHandle {
	const resources = input.resources ?? new NostalgiaFormatResources();
	const banListHash = resources.getBanListHash(input.format);
	if (banListHash === null) {
		throw new Error(`Nostalgia ban list is unavailable for format: ${input.format}`);
	}

	let roomId = createExternalRoomId();
	while (YGOProRoomList.findByAdmissionKey(`${input.format}#${roomId}`)) {
		roomId = createExternalRoomId();
	}

	const room = YGOProRoom.createNostalgia({
		id: generateUniqueId(),
		formatId: input.format,
		roomId,
		logger: input.logger,
		emitter: input.emitter,
		createdBySocketId: `matchmaking-${roomId}`,
		messageRepository: new YGOProMessageRepository(),
		banListHash,
		rankedOverride: input.rankedOverride,
	});

	YGOProRoomList.addRoom(room);
	room.isMatchmaking = true;
	room.waiting();
	input.onRoomCreated?.(room);

	return { room, roomPassword: room.admissionKey };
}
