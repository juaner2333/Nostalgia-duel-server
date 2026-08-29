import { adaptServerFrameForProtocol } from "./YGOProProtocolCompatibility";
import {
	YGOPRO_PROTOCOL_VERSION,
	YGOPRO_COMPATIBLE_PROTOCOL_VERSION,
} from "@ygopro/ygopro/protocol-version";

describe("YGOProProtocolCompatibility", () => {
	describe("adaptServerFrameForProtocol", () => {
		it("returns original buffer reference when protocol version is 0x1362", () => {
			const frame = Buffer.from([0x03, 0x00, 0x01, 0x1f, 0x00]);
			const result = adaptServerFrameForProtocol(frame, YGOPRO_PROTOCOL_VERSION);
			expect(result).toBe(frame);
		});

		it("returns original buffer reference when frame is not STOC_GAME_MSG (0x01)", () => {
			// STOC_JOIN_GAME (0x12 = 18)
			const frame = Buffer.from([0x03, 0x00, 0x12, 0x00, 0x00]);
			const result = adaptServerFrameForProtocol(frame, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
			expect(result).toBe(frame);
		});

		it("returns original buffer when frame is too short to contain header", () => {
			const frame = Buffer.from([0x01, 0x00]);
			const result = adaptServerFrameForProtocol(frame, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
			expect(result).toBe(frame);
		});

		it("returns original buffer untouched when STOC_GAME_MSG is not one of the three polyfilled messages", () => {
			// MSG_START (0x01)
			const frame = Buffer.from([0x04, 0x00, 0x01, 0x01, 0x00, 0x00]);
			const result = adaptServerFrameForProtocol(frame, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
			expect(result).toBe(frame);
		});

		describe("MSG_CONFIRM_CARDS (0x1f)", () => {
			it("removes skip_panel (0) and reduces frame length by 1 for single card", () => {
				// 0x1362: len=12 (0x0c), stoc=0x01, msg=0x1f, player=0, skip_panel=0, count=1, card=(code=89631139, ctrl=0, loc=2, seq=0)
				const input1362 = Buffer.from("0c00011f000001239f5705000200", "hex");
				const expected1361 = Buffer.from("0b00011f0001239f5705000200", "hex");

				const inputCopy = Buffer.from(input1362);
				const adapted = adaptServerFrameForProtocol(input1362, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);

				expect(adapted).toEqual(expected1361);
				expect(input1362).toEqual(inputCopy); // Immutability: original buffer is not mutated
			});

			it("removes skip_panel (1) and handles multiple cards", () => {
				// 0x1362: len=19 (0x13), stoc=0x01, msg=0x1f, player=1, skip_panel=1, count=2,
				// card0=(code=1, ctrl=1, loc=2, seq=0), card1=(code=2, ctrl=1, loc=2, seq=1)
				const input1362 = Buffer.from("1300011f0101020100000001020002000000010201", "hex");
				const expected1361 = Buffer.from("1200011f01020100000001020002000000010201", "hex");

				const adapted = adaptServerFrameForProtocol(input1362, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
				expect(adapted).toEqual(expected1361);
			});

			it("handles zero cards (count=0)", () => {
				// 0x1362: len=5 (0x05), stoc=0x01, msg=0x1f, player=0, skip_panel=0, count=0
				const input1362 = Buffer.from("0500011f000000", "hex");
				const expected1361 = Buffer.from("0400011f0000", "hex");

				const adapted = adaptServerFrameForProtocol(input1362, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
				expect(adapted).toEqual(expected1361);
			});

			it("returns original buffer when MSG_CONFIRM_CARDS buffer is truncated", () => {
				// count=2 but only header is present
				const truncated = Buffer.from("0500011f000002", "hex");
				const result = adaptServerFrameForProtocol(truncated, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
				expect(result).toBe(truncated);
			});
		});

		describe("MSG_SELECT_CHAIN (0x10)", () => {
			it("converts count=0 by inserting global forced=0 into header", () => {
				// 0x1362: len=13 (0x0d), stoc=0x01, msg=0x10, player=0, count=0, specount=0, hint1=11223344, hint2=55667788
				const input1362 = Buffer.from("0d0001100000001122334455667788", "hex");
				// 0x1361: len=14 (0x0e), stoc=0x01, msg=0x10, player=0, count=0, specount=0, forced=0, hint1=11223344, hint2=55667788
				const expected1361 = Buffer.from("0e000110000000001122334455667788", "hex");

				const inputCopy = Buffer.from(input1362);
				const adapted = adaptServerFrameForProtocol(input1362, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);

				expect(adapted).toEqual(expected1361);
				expect(input1362).toEqual(inputCopy);
			});

			it("converts single candidate with forced=1", () => {
				// 0x1362: len=27 (0x1b), stoc=0x01, msg=0x10, player=0, count=1, specount=0, hint1=0, hint2=0,
				// item0: edesc=1, forced=1, code=05579f23, ctrl=0, loc=4, seq=0, subseq=0, desc=aabbccdd
				const input1362 = Buffer.from(
					"1b00011000010000000000000000000101239f570500040000aabbccdd",
					"hex",
				);
				// 0x1361: len=27 (0x1b), stoc=0x01, msg=0x10, player=0, count=1, specount=0, forced=1, hint1=0, hint2=0,
				// item0: edesc=1, code=05579f23, ctrl=0, loc=4, seq=0, subseq=0, desc=aabbccdd
				const expected1361 = Buffer.from(
					"1b00011000010001000000000000000001239f570500040000aabbccdd",
					"hex",
				);

				const adapted = adaptServerFrameForProtocol(input1362, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
				expect(adapted).toEqual(expected1361);
			});

			it("converts multiple candidates setting global forced=1 if any candidate is forced", () => {
				// 0x1362: count=2; item0 forced=0, item1 forced=1
				const input1362 = Buffer.from(
					"29000110000200000000000000000001000100000000040000111111110201020000000004010022222222",
					"hex",
				);
				// 0x1361: count=2; global forced=1, each item's forced removed
				const expected1361 = Buffer.from(
					"280001100002000100000000000000000101000000000400001111111102020000000004010022222222",
					"hex",
				);

				const adapted = adaptServerFrameForProtocol(input1362, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
				expect(adapted).toEqual(expected1361);
			});

			it("converts multiple candidates with global forced=0 when no candidates are forced", () => {
				// 0x1362: count=2; item0 forced=0, item1 forced=0
				const input1362 = Buffer.from(
					"29000110000200000000000000000001000100000000040000111111110200020000000004010022222222",
					"hex",
				);
				// 0x1361: count=2; global forced=0
				const expected1361 = Buffer.from(
					"280001100002000000000000000000000101000000000400001111111102020000000004010022222222",
					"hex",
				);

				const adapted = adaptServerFrameForProtocol(input1362, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
				expect(adapted).toEqual(expected1361);
			});

			it("returns original buffer when MSG_SELECT_CHAIN buffer is truncated", () => {
				// count=2 but buffer is truncated
				const truncated = Buffer.from("100001100002000000000000000000", "hex");
				const result = adaptServerFrameForProtocol(truncated, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
				expect(result).toBe(truncated);
			});
		});

		describe("MSG_SELECT_SUM (0x17)", () => {
			it("returns original buffer unmodified when no candidate has bit 31 set", () => {
				// target=8 (0x08), min=1, max=2, forcedCount=0, selectCount=1, card0 value=4 (0x04)
				const input1362 = Buffer.from("17000117000008000000010200016400000000040004000000", "hex");
				const adapted = adaptServerFrameForProtocol(input1362, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
				expect(adapted).toEqual(input1362);
			});

			it("scales target and operand values by GCD when bit 31 is set", () => {
				// target=8 (0x08), min=1, max=2, forcedCount=0, selectCount=2
				// card0: code=100, ctrl=0, loc=4, seq=0, value=0x80000004 (4 with bit 31)
				// card1: code=101, ctrl=0, loc=4, seq=1, value=0x80000008 (8 with bit 31)
				// GCD(8, 4, 8) = 4
				// Scaled target = 2, card0 = 1, card1 = 2
				const input1362 = Buffer.from(
					"220001170000080000000102000264000000000400040000806500000000040108000080",
					"hex",
				);
				const expected1361 = Buffer.from(
					"220001170000020000000102000264000000000400010000006500000000040102000000",
					"hex",
				);

				const inputCopy = Buffer.from(input1362);
				const adapted = adaptServerFrameForProtocol(input1362, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);

				expect(adapted).toEqual(expected1361);
				expect(input1362).toEqual(inputCopy);
			});

			it("handles combination of bit 31 values and dual 16-bit operands", () => {
				// target=12 (0x0c), min=1, max=2, forcedCount=1, selectCount=1
				// forced card0: value=0x80000006 (6 with bit 31)
				// select card1: value=0x00060006 (op1=6, op2=6)
				// GCD(12, 6, 6, 6) = 6
				// Scaled target = 2, card0 = 1, card1 = 0x00010001 (op1=1, op2=1)
				const input1362 = Buffer.from(
					"2200011700000c0000000102016400000000040006000080016500000000040106000600",
					"hex",
				);
				const expected1361 = Buffer.from(
					"220001170000020000000102016400000000040001000000016500000000040101000100",
					"hex",
				);

				const adapted = adaptServerFrameForProtocol(input1362, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
				expect(adapted).toEqual(expected1361);
			});

			it("returns original buffer when MSG_SELECT_SUM buffer is truncated", () => {
				const truncated = Buffer.from("0a000117000008000000010202", "hex");
				const result = adaptServerFrameForProtocol(truncated, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
				expect(result).toBe(truncated);
			});
		});

		describe("mixed version isolation", () => {
			it("sending the same frame first to 0x1361 then to 0x1362 produces isolated outputs", () => {
				const frame = Buffer.from("0c00011f000001239f5705000200", "hex");
				const copyForVerification = Buffer.from(frame);

				const adapted1361 = adaptServerFrameForProtocol(frame, YGOPRO_COMPATIBLE_PROTOCOL_VERSION);
				const adapted1362 = adaptServerFrameForProtocol(frame, YGOPRO_PROTOCOL_VERSION);

				expect(adapted1361.length).toBe(frame.length - 1);
				expect(adapted1362).toBe(frame);
				expect(frame).toEqual(copyForVerification);
			});
		});
	});
});
