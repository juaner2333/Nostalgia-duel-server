import EventEmitter from "events";

import { PlayerInfoMessage } from "@ygopro/messages/client-to-server/PlayerInfoMessage";
import { Commands } from "../../../../shared/messages/Commands";
import { ClientMessage } from "../../../../shared/messages/MessageProcessor";
import { YGOProRoomState } from "../YGOProRoomState";
import { Logger } from "../../../../shared/logger/domain/Logger";
import { ISocket } from "../../../../shared/socket/domain/ISocket";
import { YGOProClient } from "../../../client/domain/YGOProClient";
import { YGOProRoom } from "../YGOProRoom";
import {
	findReconnectingPlayer,
	logReconnectJudgement,
	type ReconnectRejectionReason,
} from "@shared/room/domain/findReconnectingPlayer";
import { TurnPlayerResult, YGOProCtosTpResult, YGOProStocDuelStart } from "ygopro-msg-encode";
import { ReconnectionTokenIssuer } from "@shared/room/application/reconnect/ReconnectionTokenIssuer";
import { ReconnectionAckMessage } from "@shared/messages/server-to-client/ReconnectionAckMessage";
import { SupportedYGOProProtocolVersion } from "@ygopro/ygopro/protocol-version";

export class YGOProChoosingOrderState extends YGOProRoomState {
	constructor(
		eventEmitter: EventEmitter,
		private readonly logger: Logger,
	) {
		super(eventEmitter);

		this.logger = logger.child({ file: "YGOProChoosingOrderState" });

		this.eventEmitter.on(
			"JOIN",
			(
				message: ClientMessage,
				room: YGOProRoom,
				socket: ISocket,
				protocolVersion?: SupportedYGOProProtocolVersion,
			) => void this.handleJoin.bind(this)(message, room, socket, protocolVersion),
		);
		this.eventEmitter.on(
			Commands.TURN_CHOICE as unknown as string,
			(message: ClientMessage, room: YGOProRoom, client: YGOProClient) =>
				this.handleTurnChoice.bind(this)(message, room, client),
		);
		this.eventEmitter.on(
			"EXPRESS_RECONNECT",
			(message: ClientMessage, room: YGOProRoom, socket: ISocket) =>
				this.handleExpressReconnect.bind(this)(message, room, socket),
		);
	}

	private handleExpressReconnect(message: ClientMessage, room: YGOProRoom, socket: ISocket): void {
		this.logger.info("EXPRESS_RECONNECT");
		const token = message.data.toString("utf8");

		const player = ReconnectionTokenIssuer.resolve(
			token,
			room.id,
			(client) => client instanceof YGOProClient,
		) as YGOProClient | null;
		if (!player) {
			this.logger.info(`EXPRESS_RECONNECT: no player for token ${token}`);
			socket.send(ReconnectionAckMessage.failure());
			socket.destroy();
			return;
		}

		socket.send(ReconnectionAckMessage.success());
		room.reconnect(player, socket);

		// Re-sync mirrors the name-match reconnect for this phase (handleJoin).
		player.sendMessageToClient(room.messageSender.duelStartMessage());
		room.sendDeckCountMessage(player);
		if (room.clientWhoChoosesTurn === player) {
			player.sendMessageToClient(room.messageSender.selectTpMessage());
		}

		player.sendMessageToClient(ReconnectionTokenIssuer.rotate(player, room.id));
		player.clearReconnecting();
	}

	private handleTurnChoice(message: ClientMessage, room: YGOProRoom, player: YGOProClient): void {
		player.logger.info("handleTurnChoice");

		const data = new YGOProCtosTpResult().fromPayload(message.data);
		const turn = data.res;

		room.setPositionSwapped((turn === TurnPlayerResult.FIRST) !== (player.team === 0));
		room.dueling();
	}

	private handleJoin(
		message: ClientMessage,
		room: YGOProRoom,
		socket: ISocket,
		protocolVersion?: SupportedYGOProProtocolVersion,
	): void {
		this.logger.info("handleJoin");

		const playerInfoMessage = new PlayerInfoMessage(message.previousMessage, message.data.length);
		const reconnect = findReconnectingPlayer({
			players: room.players,
			name: playerInfoMessage.name,
			transport: socket.transport,
			ranked: room.ranked,
		});
		const seatedPlayerNames = room.players.map((player) => player.name);

		const reject = (reason: ReconnectRejectionReason): void => {
			logReconnectJudgement({
				logger: this.logger,
				result: "rejected",
				reason,
				room,
				socket,
				name: playerInfoMessage.name,
				roomPlayers: seatedPlayerNames,
			});
			const spectator = room.createSpectatorUnsafe(socket, playerInfoMessage.name, protocolVersion);
			room.addSpectatorUnsafe(spectator);
			spectator.sendMessageToClient(Buffer.from(new YGOProStocDuelStart().toFullPayload()));
			room.sendDeckCountMessage(spectator);
		};

		if (reconnect.outcome !== "takeover") {
			reject(reconnect.reason);
			return;
		}
		if (!(reconnect.player instanceof YGOProClient)) {
			reject("player_not_found");
			return;
		}

		const playerAlreadyInRoom = reconnect.player;
		logReconnectJudgement({
			logger: this.logger,
			result: "takeover",
			room,
			socket,
			previousSocket: reconnect.player.socket,
			name: playerInfoMessage.name,
			roomPlayers: seatedPlayerNames,
		});
		if (protocolVersion) {
			playerAlreadyInRoom.setProtocolVersion(protocolVersion);
		}
		room.reconnect(playerAlreadyInRoom, socket);
		playerAlreadyInRoom.sendMessageToClient(room.messageSender.duelStartMessage());
		room.sendDeckCountMessage(playerAlreadyInRoom);

		if (room.clientWhoChoosesTurn === playerAlreadyInRoom) {
			playerAlreadyInRoom.sendMessageToClient(room.messageSender.selectTpMessage());
		}
	}
}
