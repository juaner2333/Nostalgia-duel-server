import {
	YGOPRO_PROTOCOL_VERSION,
	SupportedYGOProProtocolVersion,
} from "@ygopro/ygopro/protocol-version";
import { YgoClient } from "../../../shared/client/domain/YgoClient";
import { Logger } from "../../../shared/logger/domain/Logger";
import { Team } from "../../../shared/room/Team";
import { ISocket } from "../../../shared/socket/domain/ISocket";
import { SimpleRoomMessageEmitter } from "../../SimpleRoomMessageEmitter";
import { YGOProRoom } from "../../room/domain/YGOProRoom";
import { adaptServerFrameForProtocol } from "./YGOProProtocolCompatibility";

export class YGOProClient extends YgoClient {
	public readonly logger: Logger;
	private _connectedToCore = false;
	private _needSpectatorMessages = false;
	private readonly _roomMessageEmitter: SimpleRoomMessageEmitter;
	private _rpsChosen: boolean;
	private _captain: boolean = false;
	private _isInternal: boolean = false;
	private _protocolVersion: SupportedYGOProProtocolVersion;

	constructor({
		name,
		socket,
		logger,
		position,
		room,
		host,
		id,
		team,
		protocolVersion = YGOPRO_PROTOCOL_VERSION,
	}: {
		name: string;
		socket: ISocket;
		logger: Logger;
		position: number;
		room: YGOProRoom;
		host: boolean;
		id: string | null;
		team: Team;
		protocolVersion?: SupportedYGOProProtocolVersion;
	}) {
		super({ name, position, team, socket, host, id });
		this._protocolVersion = protocolVersion;
		this.logger = logger.child({ clientName: name, roomId: room.id, file: "YGOProClient" });

		this._roomMessageEmitter = new SimpleRoomMessageEmitter(this, room);

		this._socket.onMessage((data: Buffer) => {
			this._roomMessageEmitter.handleMessage(data);
		});

		this._isReady = false;
	}

	get protocolVersion(): SupportedYGOProProtocolVersion {
		return this._protocolVersion;
	}

	setProtocolVersion(version: SupportedYGOProProtocolVersion): void {
		this._protocolVersion = version;
	}

	sendMessageToClient(message: Buffer): void {
		const adapted = adaptServerFrameForProtocol(message, this._protocolVersion);
		this._socket.send(adapted);
	}

	destroy(): void {
		this._socket.destroy();
	}

	playerPosition(position: number, team: Team): void {
		super.playerPosition(position, team);
	}

	setNeedSpectatorMessages(value: boolean): void {
		this._needSpectatorMessages = value;
	}

	setHost(value: boolean): void {
		this._host = value;
	}

	setSocket(socket: ISocket): void {
		socket.onMessage((data: Buffer) => {
			this._roomMessageEmitter.handleMessage(data);
		});
		this._socket = socket;
		this._ipAddress = socket.remoteAddress ?? null;
	}

	rpsChoose(): void {
		this._rpsChosen = true;
	}

	rpsRpsChoose(): void {
		this._rpsChosen = false;
	}

	get socket(): ISocket {
		return this._socket;
	}

	get connectedToCore(): boolean {
		return this._connectedToCore;
	}

	get needSpectatorMessages(): boolean {
		return this._needSpectatorMessages;
	}

	get rpsChosen(): boolean {
		return this._rpsChosen;
	}

	captain(): void {
		this._captain = true;
	}

	get isCaptain(): boolean {
		return this._captain;
	}

	markInternal(): void {
		this._isInternal = true;
	}

	get isInternal(): boolean {
		return this._isInternal;
	}
}
