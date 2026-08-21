import { JoinContext, JoinStrategy } from "./JoinStrategy";

/** Terminal fallback for unsupported legacy room identifiers. */
export class DefaultJoinStrategy implements JoinStrategy {
	matches(_ctx: JoinContext): boolean {
		return true;
	}

	async handle(ctx: JoinContext): Promise<void> {
		ctx.logger.info("JOIN_GAME rejected: unsupported room identifier");
		ctx.socket.destroy();
	}
}
