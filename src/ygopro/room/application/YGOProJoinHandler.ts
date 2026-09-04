import { EventEmitter } from "stream";

import { Commands } from "@shared/messages/Commands";
import { ClientMessage } from "@shared/messages/MessageProcessor";
import { Logger } from "@shared/logger/domain/Logger";
import { JoinMessageHandler } from "@shared/room/domain/JoinMessageHandler";
import { ISocket } from "@shared/socket/domain/ISocket";
import { PlayerInfoMessage } from "@ygopro/messages/client-to-server/PlayerInfoMessage";

import { ErrorMessageType, YGOProCtosJoinGame } from "ygopro-msg-encode";
import { MessageRepository } from "@ygopro/room/domain/MessageRepository";
import { YGOPRO_PROTOCOL_VERSION } from "@ygopro/ygopro/protocol-version";
import { VersionErrorClientMessage } from "@ygopro/messages/server-to-client/VersionErrorClientMessage";
import { YGOProPlayerChatMessage } from "@ygopro/messages/server-to-client/YGOProPlayerChatMessage";

import { JoinStrategyRegistry } from "./join-strategies/JoinStrategyRegistry";
import { JoinContext } from "./join-strategies/JoinStrategy";
import { JoinRejectionError } from "../domain/errors/JoinRejectionError";

export class YGOProJoinHandler implements JoinMessageHandler {
	private readonly logger: Logger;
	private readonly socket: ISocket;
	private readonly eventEmitter: EventEmitter;
	private readonly messageRepository: MessageRepository;
	private readonly registry: JoinStrategyRegistry;

	constructor(
		eventEmitter: EventEmitter,
		logger: Logger,
		socket: ISocket,
		messageRepository: MessageRepository,
		registry?: JoinStrategyRegistry,
	) {
		this.logger = logger.child({ file: "YGOProJoinHandler" });
		this.socket = socket;
		this.eventEmitter = eventEmitter;
		this.messageRepository = messageRepository;
		this.registry = registry ?? JoinStrategyRegistry.getInstance();
		this.eventEmitter.on(
			Commands.JOIN_GAME as unknown as string,
			(message: ClientMessage) => void this.handleJoinGame(message),
		);
	}

	async handleJoinGame(message: ClientMessage): Promise<void> {
		this.logger.info("JOIN_GAME");

		const playerInfoMessage = new PlayerInfoMessage(message.previousMessage, message.data.length);
		const joinMessage = new YGOProCtosJoinGame().fromPayload(message.data);

		// Every new JOIN_GAME must speak the supported protocol version, no matter
		// what room (or room state machine) it targets. Already-admitted players do
		// not re-join through this handler, so this is evaluated exactly once per
		// new connection. The reject happens before room identity parsing, join
		// strategy selection, room lookup/creation, and any room state event.
		if (joinMessage.version !== YGOPRO_PROTOCOL_VERSION) {
			this.logger.warn("Join rejected before admission", {
				reason: "unsupported_protocol_version",
				actualVersion: joinMessage.version,
				expectedVersion: YGOPRO_PROTOCOL_VERSION,
			});

			this.socket.send(VersionErrorClientMessage.create(YGOPRO_PROTOCOL_VERSION));
			// The version-error frame is already queued; send one readable hint so the
			// user knows to upgrade the client instead of the failure looking silent.
			this.socket.send(
				YGOProPlayerChatMessage.create(
					`当前服务器仅支持协议版本 0x${YGOPRO_PROTOCOL_VERSION.toString(16)}；你的客户端版本不受支持，请升级客户端至最新版本后再连接。`,
				),
			);
			// close() (not destroy()): flush both queued frames before tearing down.
			this.socket.close();
			return;
		}

		// NOTE: password is the single segment after the first "#", matching
		// YGOProRoom.create's own parsing. Do NOT join the rest with "#" — a room
		// password containing "#" must still compare equal in DefaultJoinStrategy.
		// AI/AIJOIN strategies read ctx.rawPass directly, so they are unaffected.
		const [command, password = ""] = joinMessage.pass.split("#");

		const ctx: JoinContext = {
			rawPass: joinMessage.pass,
			command,
			password,
			playerInfo: playerInfoMessage,
			socket: this.socket,
			socketId: this.socket.id as string,
			eventEmitter: this.eventEmitter,
			messageRepository: this.messageRepository,
			logger: this.logger,
			message,
		};

		const strategy = this.registry.resolve(ctx);
		try {
			await strategy.handle(ctx);
		} catch (error) {
			if (error instanceof JoinRejectionError) {
				this.logger.warn(`JOIN_GAME rejected: ${error.message}`);
				this.socket.send(YGOProPlayerChatMessage.create(error.clientMessage));
			} else {
				this.logger.error(`JOIN_GAME rejected: ${error instanceof Error ? error.message : error}`);
			}
			const errorBuf = this.messageRepository.errorMessage(ErrorMessageType.JOINERROR, 0);
			this.socket.send(errorBuf);
			// close() (not destroy()): flush the JOINERROR frame before tearing down,
			// consistent with the other join error paths.
			this.socket.close();
		}
	}
}
