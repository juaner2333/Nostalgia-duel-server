export class JoinRejectionError extends Error {
	public readonly clientMessage: string;

	constructor(internalReason: string, clientMessage: string) {
		super(internalReason);
		this.name = "JoinRejectionError";
		this.clientMessage = clientMessage;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}
