export function UTF8ToUTF16(str: string, length: number): Buffer {
	// Encode the string as UTF-16LE code units, zero-padded to exactly `length`
	// bytes — the wire format the YGOPro client decodes chat/server-error text
	// with. Spreading raw UTF-8 bytes into 16-bit slots used to garble any
	// non-ASCII character (e.g. Chinese upgrade hints), so encode the string's
	// code points directly.
	const buf = Buffer.alloc(length);
	for (let i = 0; i < Math.min(str.length, Math.floor(length / 2)); i++) {
		buf.writeUInt16LE(str.charCodeAt(i), i * 2);
	}
	return buf;
}
