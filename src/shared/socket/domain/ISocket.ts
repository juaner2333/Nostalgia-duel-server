export type SocketTransport = "tcp" | "websocket";

export interface ISocket {
	id?: string;
	roomId?: number;
	resolvedUserId?: string;
	/** Fixed at construction; lets shared domain logic tell legacy raw-TCP apart
	 * from WebSocket clients without depending on a concrete adapter. */
	readonly transport: SocketTransport;
	send(message: Buffer): void;
	onMessage(callback: (message: Buffer) => void): void;
	onClose(callback: () => void): void;
	close(): void;
	destroy(): void;
	remoteAddress: string | undefined;
	closed: boolean;
	removeAllListeners(): void;
}
