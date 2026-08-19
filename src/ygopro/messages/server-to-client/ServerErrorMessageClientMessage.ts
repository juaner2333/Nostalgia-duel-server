import { AuthFailureReason } from "@shared/user-auth/domain/AuthResult";

import { decimalToBytesBuffer } from "../../../utils";
import { UTF8ToUTF16 } from "../../../utils/UTF8ToUTF16";
import { ServerErrorMessage } from "./ServerErrorMessage";

export class ServerErrorClientMessage {
	static create(message: string): Buffer {
		const type = Buffer.from([0xf3]);
		const data = Buffer.concat([
			type,
			Buffer.from([0x04]),
			decimalToBytesBuffer(0, 1),
			Buffer.alloc(40),
			UTF8ToUTF16(message, 512),
		]);

		const size = decimalToBytesBuffer(data.length, 2);

		return Buffer.concat([size, data]);
	}

	static forAuthFailure(reason: AuthFailureReason): Buffer {
		switch (reason) {
			case AuthFailureReason.USER_NOT_FOUND:
				return ServerErrorClientMessage.create(ServerErrorMessage.USER_NOT_FOUND);
			case AuthFailureReason.USER_BANNED:
				return ServerErrorClientMessage.create(ServerErrorMessage.USER_BANNED);
			case AuthFailureReason.INVALID_PASSWORD:
				return ServerErrorClientMessage.create(ServerErrorMessage.INVALID_PASSWORD);
		}
	}
}
