import { PlayerInfoMessage } from "./PlayerInfoMessage";

describe("PlayerInfoMessage", () => {
	it("should parse name only", () => {
		const name = "Player1";
		const buffer = Buffer.from(name, "utf16le");
		const message = new PlayerInfoMessage(buffer, buffer.length);

		expect(message.name).toBe(name);
		expect(message.password).toBeNull();
		expect(message.hasMercurySignature).toBe(false);
	});

	it("should parse name and password", () => {
		const name = "Player1";
		const password = "1234";
		const fullString = `${name}:${password}`;
		const buffer = Buffer.from(fullString, "utf16le");

		const message = new PlayerInfoMessage(buffer, buffer.length);

		expect(message.name).toBe(name);
		expect(message.password).toBe(password);
		expect(message.hasMercurySignature).toBe(false);
	});

	it("should ignore extra characters after the first 4 password characters", () => {
		const name = "Player1";
		const fullString = `${name}:1234$5678`;
		const buffer = Buffer.from(fullString, "utf16le");

		const message = new PlayerInfoMessage(buffer, buffer.length);

		expect(message.name).toBe(name);
		expect(message.password).toBe("1234");
		expect(message.hasMercurySignature).toBe(true);
	});

	it("should ignore extra characters in the name when no password is provided", () => {
		const buffer = Buffer.from("Player1$5678", "utf16le");

		const message = new PlayerInfoMessage(buffer, buffer.length);

		expect(message.name).toBe("Player1");
		expect(message.password).toBeNull();
		expect(message.hasMercurySignature).toBe(true);
	});

	describe("rankedPin parsing and fixed samples", () => {
		it("extracts 4-digit ranked PIN when format is exact nickname$1234", () => {
			const raw = "Duelist$1234";
			const buffer = Buffer.from(raw, "utf16le");
			const message = new PlayerInfoMessage(buffer, buffer.length);

			expect(message.name).toBe("Duelist");
			expect(message.rankedPin).toBe("1234");
			expect(message.password).toBeNull();
		});

		it("returns null rankedPin when string lacks $ delimiter", () => {
			const raw = "Duelist1234";
			const buffer = Buffer.from(raw, "utf16le");
			const message = new PlayerInfoMessage(buffer, buffer.length);

			expect(message.name).toBe("Duelist1234");
			expect(message.rankedPin).toBeNull();
		});

		it("returns null rankedPin when string contains multiple $ delimiters", () => {
			const raw = "Due$list$1234";
			const buffer = Buffer.from(raw, "utf16le");
			const message = new PlayerInfoMessage(buffer, buffer.length);

			expect(message.name).toBe("Due");
			expect(message.rankedPin).toBeNull();
		});

		it("returns null rankedPin when PIN is not exactly 4 digits", () => {
			const cases = ["Duelist$123", "Duelist$12345", "Duelist$abcd", "Duelist$12a4"];
			for (const raw of cases) {
				const buffer = Buffer.from(raw, "utf16le");
				const message = new PlayerInfoMessage(buffer, buffer.length);
				expect(message.name).toBe("Duelist");
				expect(message.rankedPin).toBeNull();
			}
		});

		it("returns null rankedPin when nickname before $ is empty", () => {
			const raw = "$1234";
			const buffer = Buffer.from(raw, "utf16le");
			const message = new PlayerInfoMessage(buffer, buffer.length);

			expect(message.name).toBe("");
			expect(message.rankedPin).toBeNull();
		});

		it("verifies fixed UTF-16LE binary sample for PlayerInfo with rankedPin", () => {
			// "Test$9876" in UTF-16LE:
			// 'T' (0x54, 0x00), 'e' (0x65, 0x00), 's' (0x73, 0x00), 't' (0x74, 0x00),
			// '$' (0x24, 0x00), '9' (0x39, 0x00), '8' (0x38, 0x00), '7' (0x37, 0x00), '6' (0x36, 0x00)
			const fixedBuffer = Buffer.from([
				0x54, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00, 0x24, 0x00, 0x39, 0x00, 0x38, 0x00, 0x37,
				0x00, 0x36, 0x00,
			]);
			const message = new PlayerInfoMessage(fixedBuffer, fixedBuffer.length);

			expect(message.name).toBe("Test");
			expect(message.rankedPin).toBe("9876");
			expect(message.password).toBeNull();
		});

		it("ensures display name does not leak the ranked PIN", () => {
			const raw = "SuperPlayer$4321";
			const buffer = Buffer.from(raw, "utf16le");
			const message = new PlayerInfoMessage(buffer, buffer.length);

			expect(message.name).toBe("SuperPlayer");
			expect(message.name).not.toContain("4321");
			expect(message.name).not.toContain("$");
		});
	});
});
