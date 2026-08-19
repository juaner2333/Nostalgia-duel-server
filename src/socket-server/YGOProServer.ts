import { randomUUID as uuidv4 } from "crypto";
import net, { Socket } from "net";
import { config } from "src/config";
import { EventEmitter } from "stream";

import { MessageEmitter } from "@ygopro/messages/MessageEmitter";
import { Logger } from "../shared/logger/domain/Logger";
import { YGOProDisconnectHandler } from "@ygopro/room/application/YGOProDisconnectHandler";
import { YGOProRoomFinder } from "@ygopro/room/application/YGOProRoomFinder";
import { TCPClientSocket } from "../shared/socket/domain/TCPClientSocket";
import { YGOProGameCreatorHandler } from "@ygopro/room/application/YGOProGameCreatorHandler";
import { YGOProJoinHandler } from "@ygopro/room/application/YGOProJoinHandler";
import { YGOProMessageRepository } from "@ygopro/room/infrastructure/YGOProMessageRepository";

export class YGOProServer {
	private readonly server: net.Server;
	private readonly logger: Logger;
	private readonly roomFinder: YGOProRoomFinder;
	private address?: string;

	constructor(logger: Logger) {
		this.logger = logger;
		this.roomFinder = new YGOProRoomFinder();
		this.server = net.createServer({ keepAlive: true });
	}

	get boundAddress(): net.AddressInfo | string | null {
		return this.server.address();
	}

	close(): void {
		this.server.close();
	}

	initialize(port?: number): void {
		this.server.listen(port ?? config.servers.mercury.port);

		this.server.on("connection", (socket: Socket) => {
			this.address = socket.remoteAddress;
			const ygoClientSocket = new TCPClientSocket(socket);
			const eventEmitter = new EventEmitter();
			const messageRepository = new YGOProMessageRepository();

			ygoClientSocket.id = uuidv4();

			const connectionLogger = this.logger.child({
				file: "	MercuryServer",
				socketId: ygoClientSocket.id,
				remoteAddress: this.address,
			});

			connectionLogger.info("Client connected");

			const createGameListener = () => {
				new YGOProGameCreatorHandler(eventEmitter, connectionLogger, messageRepository);
			};
			const joinGameListener = () => {
				new YGOProJoinHandler(eventEmitter, connectionLogger, ygoClientSocket, messageRepository);
			};

			const messageEmitter = new MessageEmitter(
				connectionLogger,
				eventEmitter,
				createGameListener,
				joinGameListener,
			);

			socket.on("data", (data: Buffer) => {
				connectionLogger.debug(
					`Incoming message handle by Mercury Server: ${data.toString("hex")}`,
				);
				messageEmitter.handleMessage(data);

				if (messageEmitter.isInvalid) {
					connectionLogger.info("Closing connection: invalid frame length");
					socket.destroy();
				}
			});

			// Cleanup runs only on `close` (via onClose), like the other servers.
			// `end`/`error` fire before the socket is closed and `close` always
			// follows, so wiring all three ran cleanup 2-3x with stale state;
			// `end`/`error` below are logging only — do not re-add cleanup there.
			ygoClientSocket.onClose(() => {
				connectionLogger.info(`${socket.remoteAddress} left in close event`);
				const disconnectHandler = new YGOProDisconnectHandler(ygoClientSocket, this.roomFinder);
				disconnectHandler.run();
			});

			socket.on("end", () => {
				connectionLogger.info(`${socket.remoteAddress} left in end event`);
			});

			socket.on("error", (_error) => {
				connectionLogger.info(`${socket.remoteAddress} left in error event`);
			});
		});
	}
}
