import { UTF8ToUTF16 } from "src/utils/UTF8ToUTF16";

import { decimalToBytesBuffer } from "../../../utils";

export class YGOProPlayerChatMessage {
	// STOC_CHAT player_type must be a NetPlayerType (0-5, 7) or ChatColor (8,
	// 11-19); 9 was silently dropped by strictly-parsing ygopro clients.
	// ChatColor.YELLOW (16) is the protocol's conventional system-message color.
	private static readonly SYSTEM_MESSAGE_TYPE = 0x10;

	static create(message: string): Buffer {
		const type = Buffer.from([0x19]);
		const data = Buffer.concat([
			type,
			decimalToBytesBuffer(YGOProPlayerChatMessage.SYSTEM_MESSAGE_TYPE, 2),
			UTF8ToUTF16(message, 512),
		]);

		const size = decimalToBytesBuffer(data.length, 2);

		return Buffer.concat([size, data]);
	}
}
