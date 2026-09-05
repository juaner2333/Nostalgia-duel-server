import { EventEmitter } from "stream";

import { PlayerInfoMessage } from "@ygopro/messages/client-to-server/PlayerInfoMessage";

import { Commands } from "@shared/messages/Commands";
import { ClientMessage } from "@shared/messages/MessageProcessor";
import { YgoClient } from "@shared/client/domain/YgoClient";
import { Logger } from "@shared/logger/domain/Logger";
import { ISocket } from "@shared/socket/domain/ISocket";
import { ReconnectionTokenIssuer } from "@shared/room/application/reconnect/ReconnectionTokenIssuer";
import { isNameTaken } from "@shared/room/domain/isNameTaken";

import { YGOProClient } from "../../../client/domain/YGOProClient";
import {
	RANKED_READY_WINDOW_MS,
	RANKED_START_WINDOW_MS,
	RankedAdmissionResult,
	YGOProRoom,
} from "../YGOProRoom";
import { AdmitToRoom } from "@ygopro/room/admission/application/AdmitToRoom";

import {
	ChatColor,
	ErrorMessageType,
	PlayerChangeState,
	YGOProCtosUpdateDeck,
	YGOProStocChat,
} from "ygopro-msg-encode";
import { YGOProDeckCreator } from "@ygopro/deck/application/YGOProDeckCreator";
import { YGOProDeckValidator } from "@ygopro/deck/domain/YGOProDeckValidator";
import { DeckError } from "@shared/deck/domain/errors/DeckError";
import { encodeDeckErrorCode } from "@shared/deck/domain/errors/encodeDeckErrorCode";
import { YGOProRoomState } from "../YGOProRoomState";
import MercuryBanListMemoryRepository from "@ygopro/ban-list/infrastructure/YGOProBanListMemoryRepository";

export const RANKED_READY_KICK_MESSAGE = "15秒内未准备卡组，已移出排位房间。";
export const RANKED_START_KICK_MESSAGE = "房主超过15秒未开始对局，已移出排位房间。";

type RankedWindow = "none" | "ready" | "start";

export class YGOProWaitingState extends YGOProRoomState {
	private _rankedReadyTimer: NodeJS.Timeout | undefined;
	private _rankedStartTimer: NodeJS.Timeout | undefined;

	constructor(
		private readonly admitToRoom: AdmitToRoom,
		eventEmitter: EventEmitter,
		private readonly logger: Logger,
		private readonly deckCreator: YGOProDeckCreator,
		private readonly deckValidator: YGOProDeckValidator,
	) {
		super(eventEmitter);
		this.logger = logger.child({ file: "MercuryWaitingState" });
		this.eventEmitter.on(
			"JOIN",
			(message: ClientMessage, room: YGOProRoom, socket: ISocket) =>
				void this.handleJoin(message, room, socket),
		);
		this.eventEmitter.on(
			Commands.TRY_START as unknown as string,
			(message: ClientMessage, room: YGOProRoom, client: YGOProClient) =>
				void this.handleTryStart.bind(this)(message, room, client),
		);
		this.eventEmitter.on(
			Commands.OBSERVER as unknown as string,
			(message: ClientMessage, room: YGOProRoom, client: YgoClient) =>
				void this.handleToObserver.bind(this)(message, room, client),
		);
		this.eventEmitter.on(
			Commands.TO_DUEL as unknown as string,
			(message: ClientMessage, room: YGOProRoom, client: YgoClient) =>
				void this.handleToDuel.bind(this)(message, room, client),
		);
		this.eventEmitter.on(
			Commands.UPDATE_DECK as unknown as string,
			(message: ClientMessage, room: YGOProRoom, client: YgoClient) =>
				void this.handleUpdateDeck.bind(this)(message, room, client as YGOProClient),
		);
		this.eventEmitter.on(
			Commands.NOT_READY as unknown as string,
			(message: ClientMessage, room: YGOProRoom, client: YgoClient) =>
				void this.handleNotReady.bind(this)(message, room, client as YGOProClient),
		);
	}

	public override removeAllListener(): void {
		super.removeAllListener();
		// Timers are not emitter listeners: they have to be dropped explicitly so
		// a state transition (rps, teardown, destroy) cannot leave a kick armed.
		this.cancelRankedDeadlines();
	}

	public async handleJoin(
		message: ClientMessage,
		room: YGOProRoom,
		socket: ISocket,
	): Promise<RankedAdmissionResult> {
		this.logger.info(`handleJoin: ${message.data.toString("hex")}`);

		if (socket.closed) {
			return "rejected";
		}

		const maxByteCount =
			message.data && message.data.length > 0
				? message.data.length
				: (message.previousMessage?.length ?? 40);
		const playerInfoMessage = new PlayerInfoMessage(message.previousMessage, maxByteCount);

		return await room.mutex.runExclusive(async () => {
			if (socket.closed) {
				return "rejected";
			}

			if (room.isDirectRanked && socket.resolvedUserId) {
				const existingPlayer = room.players?.find((p) => p.id === socket.resolvedUserId) as
					| YGOProClient
					| undefined;

				if (existingPlayer) {
					this.takeoverSeat(room, existingPlayer, socket);
					return "reconnected";
				}
			}

			if (isNameTaken(room.players ?? [], playerInfoMessage.name)) {
				this.sendExistingPlayerErrorMessage(playerInfoMessage, socket);
				return "rejected";
			}

			const initialPlayerCount = room.players?.length ?? 0;
			const initialSpectatorCount = room.spectators?.length ?? 0;

			await this.admitToRoom.run(
				socket,
				playerInfoMessage,
				room.admissionTarget(socket, playerInfoMessage),
			);

			if (socket.closed) {
				room.removePlayerBySocket?.(socket);
				room.removeSpectatorBySocket?.(socket);
				return "rejected";
			}

			if (
				(room.players?.length ?? 0) > initialPlayerCount &&
				room.players?.some((p) => p.socket === socket)
			) {
				// A new seat always gets a full window, even when the previous
				// occupant's window was still running.
				this.reconcileRankedDeadlines(room, true);

				return "seated";
			}

			if (
				(room.spectators?.length ?? 0) > initialSpectatorCount &&
				room.spectators?.some((s) => s.socket === socket)
			) {
				return "spectator";
			}

			return "rejected";
		});
	}

	private takeoverSeat(room: YGOProRoom, existingPlayer: YGOProClient, socket: ISocket): void {
		const oldSocket = existingPlayer.socket;
		if (oldSocket !== socket) {
			oldSocket.removeAllListeners();
			oldSocket.close();
		}

		existingPlayer.setSocket(socket);
		socket.roomId = room.id;

		socket.send(room.messageSender.joinGameMessage(room.hostInfo, room.banListHash));
		socket.send(room.messageSender.typeChangeMessage(existingPlayer.position, existingPlayer.host));

		room.clients.forEach((client: YGOProClient) => {
			const playerEnterMessageBuffer = room.messageSender.playerEnterMessage(
				room.getDisplayNameFor(client, existingPlayer),
				client.position,
			);
			socket.send(playerEnterMessageBuffer);

			if (client.deck) {
				const state = client.isReady ? PlayerChangeState.READY : PlayerChangeState.NOTREADY;
				socket.send(room.messageSender.playerChangeMessage(client.position, state));
			}
		});
	}

	private handleTryStart(_message: ClientMessage, room: YGOProRoom, player: YGOProClient): void {
		player.logger.info("handleTryStart");

		if (!player.host) {
			return;
		}

		if (!room.allPlayersReady) {
			return;
		}

		this.cancelRankedDeadlines();

		if (room.isDirectRanked) {
			room.revealRealPlayerNames();
		}

		for (const player of room.clients) {
			(player as YGOProClient).sendMessageToClient(room.messageSender.duelStartMessage());
			room.sendDeckCountMessage(player as YGOProClient);
		}

		// Issue a per-player reconnection token at match start so every duel phase
		// (RPS, choosing order, dueling, side-decking) supports token reconnect.
		// WindBot rooms (noReconnect) are skipped — bots never reconnect.
		if (!room.noReconnect) {
			for (const player of room.players as YGOProClient[]) {
				player.sendMessageToClient(ReconnectionTokenIssuer.issue(player, room.id));
			}
		}

		this.toRPS(room);
		room.createMatch();
		room.rps();
	}

	private handleToObserver(message: ClientMessage, room: YGOProRoom, player: YGOProClient): void {
		player.logger.info(`handleToObserver: ${message.data.toString("hex")}`);

		room.mutex.runExclusive(() => {
			if (player.isSpectator) {
				return;
			}

			if (!player.host) {
				room.playerToSpectatorUnsafe(player);
			}
		});
	}

	private handleToDuel(_message: ClientMessage, room: YGOProRoom, player: YGOProClient): void {
		player.logger.info("handleToDuel");

		room.mutex.runExclusive(() => {
			if (player.isSpectator) {
				if (room.isDirectRanked) {
					return;
				}
				// Taking a seat always passes admission: a spectator may only sit if
				// the room's league accepts how it authenticated. A wrong-league
				// spectator stays in the stands (closes the escalation through the
				// stands door, mirroring the JOIN door).
				const credential = player.credential ?? { kind: "guest" as const, name: player.name };
				if (!room.league.admitsAsPlayer(credential)) {
					return;
				}
				room.spectatorToPlayerUnsafe(player);

				return;
			}

			room.movePlayerToAnotherCellUnsafe(player);
		});
	}

	private async handleUpdateDeck(
		message: ClientMessage,
		room: YGOProRoom,
		player: YGOProClient,
	): Promise<void> {
		player.logger.info(`handleUpdateDeck: ${message.data.toString("hex")}`);

		const updateDeckMessage = new YGOProCtosUpdateDeck().fromPayload(message.data);
		if (player.isSpectator) {
			return;
		}

		const deckOrError = await this.deckCreator.build({
			main: updateDeckMessage.deck.main,
			side: updateDeckMessage.deck.side,
			banListHash: room.banListHash,
		});

		if (deckOrError instanceof DeckError) {
			this.logger.warn(
				`Deck build error: type=0x${deckOrError.type.toString(16)}, code=${deckOrError.code}, format=${room.formatId}, rule=${room.hostInfo.rule}`,
			);
			room.notReadyUnsafe(player);
			player.sendMessageToClient(
				room.messageSender.errorMessage(
					ErrorMessageType.DECKERROR,
					encodeDeckErrorCode(deckOrError.type, deckOrError.code),
				),
			);
			return;
		}

		const deck = deckOrError;

		if (player.isInternal) {
			room.mutex.runExclusive(() => {
				room.setDecksToPlayerUnsafe(player.position, deck);
				this.reconcileRankedDeadlines(room);
			});
			return;
		}

		const hasError = room.shouldValidateDeck() && this.deckValidator.validate(deck);
		if (hasError) {
			const failedCard = deck.allCards.find((c) => Number(c.code) === hasError.code);
			this.logger.warn(
				`Deck validation error: type=0x${hasError.type.toString(16)}, code=${hasError.code}, cardOt=${failedCard?.variant ?? "N/A"}, format=${room.formatId}, rule=${room.hostInfo.rule}`,
			);
			room.notReadyUnsafe(player);
			player.sendMessageToClient(
				room.messageSender.errorMessage(
					ErrorMessageType.DECKERROR,
					encodeDeckErrorCode(hasError.type, hasError.code),
				),
			);
			return;
		}

		room.mutex.runExclusive(() => {
			room.setDecksToPlayerUnsafe(player.position, deck);
			this.reconcileRankedDeadlines(room);
		});
	}

	private async handleNotReady(message: ClientMessage, room: YGOProRoom, player: YGOProClient) {
		player.logger.info(`handleNotReady: ${message.data.toString("hex")}`);

		room.mutex.runExclusive(() => {
			room.notReadyUnsafe(player);
			this.reconcileRankedDeadlines(room);
		});
	}

	/**
	 * Aligns the one-shot ranked kick windows with the room's current seats: a
	 * full ranked room gets either a ready window (someone still has to ready a
	 * deck) or a start window (everyone is ready and the host must start).
	 *
	 * A window already armed for the same reason keeps its original deadline, so
	 * toggling ready/not-ready cannot buy extra time; `restart` forces a fresh
	 * window and is used when a new player takes the seat.
	 */
	private reconcileRankedDeadlines(room: YGOProRoom, restart: boolean = false): void {
		const desired = this.desiredRankedWindow(room);
		if (desired === "none") {
			this.cancelRankedDeadlines();

			return;
		}

		const armed = this.armedRankedWindow();
		if (armed === desired && !restart) {
			return;
		}

		this.cancelRankedDeadlines();

		if (desired === "ready") {
			this._rankedReadyTimer = setTimeout(
				() => this.handleRankedReadyExpiry(room),
				room.rankedReadyWindowMs ?? RANKED_READY_WINDOW_MS,
			);

			return;
		}

		this._rankedStartTimer = setTimeout(
			() => this.handleRankedStartExpiry(room),
			room.rankedStartWindowMs ?? RANKED_START_WINDOW_MS,
		);
	}

	private desiredRankedWindow(room: YGOProRoom): RankedWindow {
		if (!room.isDirectRanked || (room.players?.length ?? 0) !== 2) {
			return "none";
		}

		return room.allPlayersReady ? "start" : "ready";
	}

	private armedRankedWindow(): RankedWindow {
		if (this._rankedStartTimer) {
			return "start";
		}

		return this._rankedReadyTimer ? "ready" : "none";
	}

	private handleRankedReadyExpiry(room: YGOProRoom): void {
		this._rankedReadyTimer = undefined;
		if (!this.canKickFromRankedRoom(room)) {
			return;
		}

		this.kickPlayers(
			room,
			(room.players as YGOProClient[]).filter((player) => !player.isReady),
			RANKED_READY_KICK_MESSAGE,
		);
	}

	private handleRankedStartExpiry(room: YGOProRoom): void {
		this._rankedStartTimer = undefined;
		if (!this.canKickFromRankedRoom(room) || !room.allPlayersReady) {
			return;
		}

		const host = (room.players as YGOProClient[]).find((player) => player.host);
		if (host) {
			this.kickPlayers(room, [host], RANKED_START_KICK_MESSAGE);
		}
	}

	// Re-check at expiry time: a leave, join, disconnect or takeover that won the
	// race must never kick anyone.
	private canKickFromRankedRoom(room: YGOProRoom): boolean {
		return room.isDirectRanked && (room.players?.length ?? 0) === 2 && !room.finalizing;
	}

	private kickPlayers(room: YGOProRoom, players: YGOProClient[], message: string): void {
		for (const player of players) {
			if (player.socket.closed) {
				continue;
			}
			this.logger.info("ranked_waiting_kick", {
				roomId: room.id,
				player: player.name,
				reason: message,
			});
			const chat = new YGOProStocChat().fromPartial({
				player_type: ChatColor.RED,
				msg: message,
			});
			player.sendMessageToClient(Buffer.from(chat.toFullPayload()));
			// Closing the socket reuses the existing WAITING disconnect pipeline
			// (occupancy release, LEAVE broadcast, empty-room teardown).
			player.socket.close();
		}
	}

	private cancelRankedDeadlines(): void {
		if (this._rankedReadyTimer) {
			clearTimeout(this._rankedReadyTimer);
		}
		if (this._rankedStartTimer) {
			clearTimeout(this._rankedStartTimer);
		}
		this._rankedReadyTimer = undefined;
		this._rankedStartTimer = undefined;
	}
}
