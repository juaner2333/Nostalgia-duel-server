import {
	YGOPRO_PROTOCOL_VERSION,
	SupportedYGOProProtocolVersion,
} from "@ygopro/ygopro/protocol-version";

const STOC_GAME_MSG = 0x01;
const MSG_CONFIRM_CARDS = 0x1f;
const MSG_SELECT_CHAIN = 0x10;
const MSG_SELECT_SUM = 0x17;

function gcdTwo(a: number, b: number): number {
	let x = Math.abs(a);
	let y = Math.abs(b);
	while (y !== 0) {
		const temp = y;
		y = x % y;
		x = temp;
	}
	return x;
}

function calculateGcd(numbers: number[]): number {
	if (numbers.length === 0) {
		return 1;
	}
	return numbers.reduce((acc, n) => gcdTwo(acc, n));
}

/**
 * Pure function that adapts a server-to-client wire frame for older YGOPro clients.
 *
 * Requirements:
 * 1. 0x1362 clients receive the frame verbatim without allocation or mutation.
 * 2. Non-STOC_GAME_MSG frames are returned verbatim.
 * 3. 0x1361 transformations create a new Buffer and NEVER mutate the input Buffer.
 * 4. Truncated or malformed frames are returned unmodified without throwing.
 */
export function adaptServerFrameForProtocol(
	frame: Buffer,
	protocolVersion: SupportedYGOProProtocolVersion,
): Buffer {
	if (protocolVersion === YGOPRO_PROTOCOL_VERSION) {
		return frame;
	}

	// Wire frame header must contain at least: 2 bytes length + 1 byte STOC command + 1 byte MSG type
	if (frame.length < 4) {
		return frame;
	}

	const stocCommand = frame[2];
	if (stocCommand !== STOC_GAME_MSG) {
		return frame;
	}

	const msgType = frame[3];

	if (msgType === MSG_CONFIRM_CARDS) {
		return adaptConfirmCardsTo1361(frame);
	}

	if (msgType === MSG_SELECT_CHAIN) {
		return adaptSelectChainTo1361(frame);
	}

	if (msgType === MSG_SELECT_SUM) {
		return adaptSelectSumTo1361(frame);
	}

	return frame;
}

/**
 * Adapt MSG_CONFIRM_CARDS from 0x1362 to 0x1361.
 * 0x1362 layout: [len:2][stoc:1][0x1f:1][player:1][skip_panel:1][count:1][cards: count * 7]
 * 0x1361 layout: [len:2][stoc:1][0x1f:1][player:1][count:1][cards: count * 7]
 */
function adaptConfirmCardsTo1361(frame: Buffer): Buffer {
	// Need at least: len(2) + stoc(1) + type(1) + player(1) + skip_panel(1) + count(1) = 7 bytes
	if (frame.length < 7) {
		return frame;
	}

	const player = frame[4];
	const count = frame[6];
	const expectedCardBytes = count * 7;
	const minExpectedLength = 7 + expectedCardBytes;

	if (frame.length < minExpectedLength) {
		return frame;
	}

	const newLength = frame.length - 1;
	const newFrame = Buffer.allocUnsafe(newLength);

	// Write new 2-byte LE frame length (excluding the 2 length bytes themselves)
	newFrame.writeUInt16LE(newLength - 2, 0);
	newFrame[2] = STOC_GAME_MSG;
	newFrame[3] = MSG_CONFIRM_CARDS;
	newFrame[4] = player;
	newFrame[5] = count;

	// Copy card structures (and any trailing bytes)
	frame.copy(newFrame, 6, 7);

	return newFrame;
}

/**
 * Adapt MSG_SELECT_CHAIN from 0x1362 to 0x1361.
 * 0x1362 layout: [len:2][stoc:1][0x10:1][player:1][count:1][specount:1][hint1:4][hint2:4][items: count * 14 (edesc:1, forced:1, ...)]
 * 0x1361 layout: [len:2][stoc:1][0x10:1][player:1][count:1][specount:1][forced:1][hint1:4][hint2:4][items: count * 13 (edesc:1, ...)]
 */
function adaptSelectChainTo1361(frame: Buffer): Buffer {
	// Need header: len(2) + stoc(1) + type(1) + player(1) + count(1) + specount(1) + hint1(4) + hint2(4) = 15 bytes
	if (frame.length < 15) {
		return frame;
	}

	const player = frame[4];
	const count = frame[5];
	const specount = frame[6];
	const expectedItemsBytes = count * 14;
	const minExpectedLength = 15 + expectedItemsBytes;

	if (frame.length < minExpectedLength) {
		return frame;
	}

	// Check if any candidate has forced === 1
	let anyForced = 0;
	for (let i = 0; i < count; i++) {
		const itemOffset = 15 + i * 14;
		if (frame[itemOffset + 1] !== 0) {
			anyForced = 1;
			break;
		}
	}

	const trailingBytes = frame.length - minExpectedLength;
	const newLength = 16 + count * 13 + trailingBytes;
	const newFrame = Buffer.allocUnsafe(newLength);

	newFrame.writeUInt16LE(newLength - 2, 0);
	newFrame[2] = STOC_GAME_MSG;
	newFrame[3] = MSG_SELECT_CHAIN;
	newFrame[4] = player;
	newFrame[5] = count;
	newFrame[6] = specount;
	newFrame[7] = anyForced;

	// Copy hint1 (4 bytes) and hint2 (4 bytes)
	frame.copy(newFrame, 8, 7, 15);

	// Copy each candidate item without the 1-byte per-item forced field
	for (let i = 0; i < count; i++) {
		const srcItemOffset = 15 + i * 14;
		const dstItemOffset = 16 + i * 13;

		newFrame[dstItemOffset] = frame[srcItemOffset]; // edesc
		// Copy code(4) + controller(1) + location(1) + sequence(1) + subsequence(1) + desc(4) = 12 bytes
		frame.copy(newFrame, dstItemOffset + 1, srcItemOffset + 2, srcItemOffset + 14);
	}

	// Copy any trailing bytes
	if (trailingBytes > 0) {
		frame.copy(newFrame, 16 + count * 13, minExpectedLength);
	}

	return newFrame;
}

/**
 * Adapt MSG_SELECT_SUM from 0x1362 to 0x1361.
 * 0x1362 layout: [len:2][stoc:1][0x17:1][mode:1][player:1][target:4][min:1][max:1][forcedCount:1][forcedCards: forcedCount*11][selectCount:1][selectCards: selectCount*11]
 * Card layout (11 bytes): [code:4][controller:1][location:1][sequence:1][value:4]
 *
 * If any card value uses the high bit (0x80000000) for single 31-bit value, scale target and values by GCD.
 */
function adaptSelectSumTo1361(frame: Buffer): Buffer {
	// Need header up to forcedCount: len(2) + stoc(1) + type(1) + mode(1) + player(1) + target(4) + min(1) + max(1) + forcedCount(1) = 13 bytes
	if (frame.length < 13) {
		return frame;
	}

	const forcedCount = frame[12];
	const selectCountOffset = 13 + forcedCount * 11;
	if (frame.length < selectCountOffset + 1) {
		return frame;
	}

	const selectCount = frame[selectCountOffset];
	const minExpectedLength = 14 + (forcedCount + selectCount) * 11;
	if (frame.length < minExpectedLength) {
		return frame;
	}

	const targetValue = frame.readUInt32LE(6);

	// Collect value offsets within frame
	const valueOffsets: number[] = [];
	for (let i = 0; i < forcedCount; i++) {
		valueOffsets.push(13 + i * 11 + 7);
	}
	for (let i = 0; i < selectCount; i++) {
		valueOffsets.push(selectCountOffset + 1 + i * 11 + 7);
	}

	const values = valueOffsets.map((offset) => ({
		offset,
		value: frame.readUInt32LE(offset),
	}));

	// If no card has bit 31 set, 0x1361 interprets values as dual 16-bit operands natively — return frame
	if (!values.some((v) => (v.value & 0x80000000) !== 0)) {
		return frame;
	}

	// Collect numbers for GCD calculation
	const gcdCandidates: number[] = [];
	if (targetValue > 0) {
		gcdCandidates.push(targetValue);
	}

	for (const { value } of values) {
		if ((value & 0x80000000) !== 0) {
			const singleVal = value & 0x7fffffff;
			if (singleVal > 0) {
				gcdCandidates.push(singleVal);
			}
		} else {
			const op1 = value & 0xffff;
			const op2 = (value >>> 16) & 0xffff;
			if (op1 > 0) gcdCandidates.push(op1);
			if (op2 > 0) gcdCandidates.push(op2);
		}
	}

	const gcdValue = calculateGcd(gcdCandidates);
	const divisor = gcdValue > 0 ? gcdValue : 1;

	// Create a new Buffer copy to ensure immutability of the original frame
	const newFrame = Buffer.from(frame);

	newFrame.writeUInt32LE(Math.floor(targetValue / divisor), 6);

	for (const { offset, value } of values) {
		let newValue: number;
		if ((value & 0x80000000) !== 0) {
			const scaled = Math.floor((value & 0x7fffffff) / divisor) & 0xffff;
			newValue = scaled;
		} else {
			const op1 = Math.floor((value & 0xffff) / divisor) & 0xffff;
			const op2 = Math.floor(((value >>> 16) & 0xffff) / divisor) & 0xffff;
			newValue = (op1 | (op2 << 16)) >>> 0;
		}
		newFrame.writeUInt32LE(newValue, offset);
	}

	return newFrame;
}
