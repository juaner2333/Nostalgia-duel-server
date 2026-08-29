// YGOPro network protocol version (PVERSION).
// Internal server engine and replays use YGOPRO_PROTOCOL_VERSION (0x1362).
// YGOPRO_COMPATIBLE_PROTOCOL_VERSION (0x1361) is accepted at join admission and
// adapted on outbound STOC_GAME_MSG frames.
export const YGOPRO_PROTOCOL_VERSION = 0x1362;
export const YGOPRO_COMPATIBLE_PROTOCOL_VERSION = 0x1361;

export type SupportedYGOProProtocolVersion = 0x1361 | 0x1362;

export const isSupportedYGOProProtocolVersion = (
	version: number,
): version is SupportedYGOProProtocolVersion => {
	return version === YGOPRO_PROTOCOL_VERSION || version === YGOPRO_COMPATIBLE_PROTOCOL_VERSION;
};
