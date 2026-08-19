/**
 * Fixed YGOPro first-packet sample — the server's TCP wire-protocol contract.
 *
 * Hand-verified byte layout (do NOT regenerate with the encoder under test —
 * that would mask protocol regressions). When the server's protocol or version
 * config changes, update this sample, its expectations, and the spec together.
 *
 * Frame format (MessageProcessor): [lenLo lenHi][cmd][payload…] where len is
 * u16 little-endian and INCLUDES the 1 command byte but NOT the prefix itself.
 *
 * Frame 1 — ExternalAddress (CTOS 0x17 = 23), consumed by the framer but not
 * dispatched (no Commands entry); must not disturb the PlayerInfo frame the
 * later JoinGame relies on:
 *   13 00           wireLength 19 (1 + 18 payload bytes)
 *   17              command CTOS_EXTERNAL_ADDRESS
 *   c0 a8 01 64     real_ip 192.168.1.100 (u32, network byte order)
 *   6d 00 … 33 00   hostname "mdpro3" (UTF-16LE, 6 chars)
 *   00 00           UTF-16LE NUL terminator
 *
 * Frame 2 — PlayerInfo (CTOS 0x10 = 16), 20 UTF-16LE char slots:
 *   29 00           wireLength 41 (1 + 40 payload bytes)
 *   10              command CTOS_PLAYER_INFO
 *   4a 00 61 00 64 00 65 00 6e 00   "Jaden" (UTF-16LE, 5 slots)
 *   00 ×30          15 unused slots
 *
 * Frame 3 — JoinGame (CTOS 0x12 = 18), 48-byte payload:
 *   31 00           wireLength 49 (1 + 48 payload bytes)
 *   12              command CTOS_JOIN_GAME
 *   62 13           version 0x1362 (4962) u16 LE — must equal mercuryConfig.version
 *   cc cc           align bytes
 *   2a 00 00 00     reserved/game id 42 (u32 LE)
 *   72 00 6f 00 6f 00 6d 00 31 00   pass "room1" (UTF-16LE, 5 slots)
 *   00 ×30          15 unused slots
 */

export const EXTERNAL_ADDRESS_FRAME_HEX = "130017c0a801646d006400700072006f0033000000";

export const PLAYER_INFO_FRAME_HEX =
	"2900104a006100640065006e00000000000000000000000000000000000000000000000000000000000000";

export const JOIN_GAME_FRAME_HEX =
	"3100126213cccc2a00000072006f006f006d003100000000000000000000000000000000000000000000000000000000000000";

export const YGOPRO_FIRST_PACKET_HEX = `${EXTERNAL_ADDRESS_FRAME_HEX}${PLAYER_INFO_FRAME_HEX}${JOIN_GAME_FRAME_HEX}`;

export const PLAYER_INFO_PAYLOAD_HEX = PLAYER_INFO_FRAME_HEX.slice(6);

export const JOIN_GAME_PAYLOAD_HEX = JOIN_GAME_FRAME_HEX.slice(6);

export const YGOPRO_FIRST_PACKET = Buffer.from(YGOPRO_FIRST_PACKET_HEX, "hex");

export interface ExpectedFirstPacketFrame {
	command: number;
	wireLength: number;
	frameByteLength: number;
}

export const EXPECTED_EXTERNAL_ADDRESS: ExpectedFirstPacketFrame & {
	realIp: string;
	hostname: string;
} = {
	command: 0x17,
	wireLength: 19,
	frameByteLength: 21,
	realIp: "192.168.1.100",
	hostname: "mdpro3",
};

export const EXPECTED_PLAYER_INFO: ExpectedFirstPacketFrame & {
	name: string;
	password: string | null;
	hasMercurySignature: boolean;
} = {
	command: 0x10,
	wireLength: 41,
	frameByteLength: 43,
	name: "Jaden",
	password: null,
	hasMercurySignature: false,
};

export const EXPECTED_JOIN_GAME: ExpectedFirstPacketFrame & {
	version: number;
	align: number;
	gameId: number;
	pass: string;
	/** JoinContext semantics: pass splits at the first "#" into room name + password. */
	joinRoomName: string;
	joinRoomPassword: string;
} = {
	command: 0x12,
	wireLength: 49,
	frameByteLength: 51,
	version: 0x1362,
	align: 0xcccc,
	gameId: 42,
	pass: "room1",
	joinRoomName: "room1",
	joinRoomPassword: "",
};
