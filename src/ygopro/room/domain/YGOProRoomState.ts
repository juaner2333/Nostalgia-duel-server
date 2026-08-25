import { EventEmitter } from "stream";

import { YgoClient } from "@shared/client/domain/YgoClient";
import { Commands } from "@shared/messages/Commands";
import { ClientMessage } from "@shared/messages/MessageProcessor";
import { ISocket } from "@shared/socket/domain/ISocket";
import { mercuryConfig } from "@ygopro/config";
import {
	EMOTE_COOLDOWN_MS,
	MAX_ID_LENGTH,
	buildStocEmoteFrame,
	isValidEmoteId,
} from "@ygopro/emote/emote-protocol";
import { PlayerInfoMessage } from "@ygopro/messages/client-to-server/PlayerInfoMessage";
import { YGOProJoinGameMessage } from "@ygopro/messages/YGOProJoinGameMessage";
import { ErrorClientMessage } from "@ygopro/messages/server-to-client/ErrorClientMessage";
import { ErrorMessages } from "@ygopro/messages/server-to-client/ErrorMessages";
import { ServerErrorClientMessage } from "@ygopro/messages/server-to-client/ServerErrorMessageClientMessage";
import { VersionErrorClientMessage } from "@ygopro/messages/server-to-client/VersionErrorClientMessage";
import { YGOProPlayerChatMessage } from "@ygopro/messages/server-to-client/YGOProPlayerChatMessage";
import { NetPlayerType, YGOProStocChat } from "ygopro-msg-encode";

import { BufferToUTF16 } from "../../../utils/BufferToUTF16";
import WebSocketSingleton from "../../../web-socket-server/WebSocketSingleton";

import { YGOProRoom } from "./YGOProRoom";

export abstract class YGOProRoomState {
	protected readonly eventEmitter: EventEmitter;

	constructor(eventEmitter: EventEmitter) {
		this.eventEmitter = eventEmitter;

		this.eventEmitter.on(
			Commands.CHAT as unknown as string,
			(message: ClientMessage, room: YGOProRoom, client: YgoClient) =>
				this.handleChat(message, room, client),
		);

		this.eventEmitter.on(
			Commands.EMOTE as unknown as string,
			(message: ClientMessage, room: YGOProRoom, client: YgoClient) =>
				this.handleEmote(message, room, client),
		);
	}

	removeAllListener(): void {
		this.eventEmitter.removeAllListeners();
	}

	protected validateVersion(message: Buffer, socket: ISocket): void {
		const joinMessage = new YGOProJoinGameMessage(message);

		if (joinMessage.version !== mercuryConfig.version) {
			socket.send(VersionErrorClientMessage.create(mercuryConfig.version));

			throw new Error(
				`Version mismatch: got 0x${joinMessage.version.toString(16)}, expected 0x${mercuryConfig.version.toString(16)}`,
			);
		}
	}

	protected sendExistingPlayerErrorMessage(
		playerInfoMessage: PlayerInfoMessage,
		socket: ISocket,
	): void {
		socket.send(
			ServerErrorClientMessage.create(
				`Already exists a player with the name :${playerInfoMessage.name}`,
			),
		);
		socket.send(ErrorClientMessage.create(ErrorMessages.JOIN_ERROR));
		// close() (not destroy()): flush both error frames before tearing down,
		// consistent with the other join error paths.
		socket.close();
	}

	protected notifyDuelStart(room: YGOProRoom): void {
		if (room.isFirstDuel()) {
			WebSocketSingleton.getInstance().broadcast({
				action: "ADD-ROOM",
				data: room.toRealTimePresentation(),
			});
		} else {
			WebSocketSingleton.getInstance().broadcast({
				action: "UPDATE-ROOM",
				data: room.toRealTimePresentation(),
			});
		}
	}

	protected toRPS(room: YGOProRoom): void {
		const team0Player = room.getTeamPlayers(0)[0];
		const team1Player = room.getTeamPlayers(1)[0];
		if (!team0Player || !team1Player) {
			return;
		}

		const message = room.messageSender.selectHandMessage();
		team0Player.captain();
		team1Player.captain();
		team0Player.sendMessageToClient(message);
		team1Player.sendMessageToClient(message);
	}

	private handleChat(message: ClientMessage, room: YGOProRoom, client: YgoClient): void {
		const sanitized = BufferToUTF16(message.data, message.data.length);
		if (sanitized === ":score") {
			client.socket.send(YGOProPlayerChatMessage.create(room.score));

			return;
		}

		this.handleMercuryChat(message, room, client);
	}

	private handleMercuryChat(message: ClientMessage, room: YGOProRoom, client: YgoClient): void {
		const playerType = client.isSpectator
			? NetPlayerType.OBSERVER
			: room.isPositionSwapped
				? client.position ^ 1
				: client.position;

		const content = BufferToUTF16(message.data, message.data.length);
		// STOC_CHAT (opcode 0x19) only carries player_type + msg — there is no name field,
		// and every spectator shares player_type=7, so the client cannot tell which spectator
		// spoke (it would fall back to a duelist's identity). Prefix the spectator's name into
		// the text so the client can attribute the message to the right person.
		const outgoing = client.isSpectator
			? `${client.name.replace(/\0/g, "").trim()}: ${content}`
			: content;
		const chatMessage = Buffer.from(
			new YGOProStocChat().fromPartial({ player_type: playerType, msg: outgoing }).toFullPayload(),
		);

		room.clients.forEach((_client: YgoClient) => {
			_client.socket.send(chatMessage);
		});
	}

	/**
	 * Relay an emote (custom CTOS 0xfc) to the whole room as STOC 0xfc. Mercury
	 * rooms only — the opcode is understood solely by this project's client, and
	 * a standard ygopro client would neither send nor decode it. Validates the
	 * id against the catalog and rate-limits per client before broadcasting.
	 */
	private handleEmote(message: ClientMessage, room: YGOProRoom, client: YgoClient): void {
		// Only seated duelists may emote. Spectators watch and receive emotes but
		// cannot send them — reject here (the authoritative gate; the client also
		// hides the picker for spectators).
		if (client.isSpectator) return;

		// Byte-length pre-check before the utf-8 conversion, so a garbage frame
		// (megabytes of body) can't force a large string allocation just to fail.
		if (message.data.length === 0 || message.data.length > MAX_ID_LENGTH) return;

		const emoteId = message.data.toString("utf8");
		if (!isValidEmoteId(emoteId)) return;
		if (!client.tryEmote(Date.now(), EMOTE_COOLDOWN_MS)) return;

		// Seat resolution mirrors handleMercuryChat so the client maps the sender
		// to the correct HUD side (accounting for a swapped board).
		const playerType = room.isPositionSwapped ? client.position ^ 1 : client.position;

		const frame = buildStocEmoteFrame(playerType, emoteId);
		room.clients.forEach((c: YgoClient) => {
			c.socket.send(frame);
		});
	}
}
