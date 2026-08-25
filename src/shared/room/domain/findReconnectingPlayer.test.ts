import { YgoClient } from "@shared/client/domain/YgoClient";
import { SocketTransport } from "@shared/socket/domain/ISocket";

import { findReconnectingPlayer } from "./findReconnectingPlayer";

const player = (
	overrides: Partial<{
		name: string;
		isStrongAuth: boolean;
		closed: boolean;
		socketRemoteAddress: string | null;
		ipAddress: string | null;
		transport: SocketTransport;
	}> = {},
): YgoClient =>
	({
		name: overrides.name ?? "Jaden",
		isStrongAuth: overrides.isStrongAuth ?? false,
		// The stable source IP cached on the player (survives socket swaps and
		// the old socket's `remoteAddress` going stale after close).
		ipAddress: overrides.ipAddress ?? "1.1.1.1",
		socket: {
			closed: overrides.closed ?? true,
			remoteAddress: overrides.socketRemoteAddress ?? null,
			transport: overrides.transport ?? "tcp",
		},
	}) as unknown as YgoClient;

describe("findReconnectingPlayer", () => {
	it("matches a disconnected legacy player by name in a ranked room", () => {
		const p = player();
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			remoteAddress: "9.9.9.9",
			transport: "tcp",
			ranked: true,
		});
		expect(result).toEqual({ outcome: "takeover", player: p });
	});

	it("NEVER matches a strong-auth (ticket) player — it is unreachable by name", () => {
		const p = player({ isStrongAuth: true });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			remoteAddress: "1.1.1.1",
			transport: "tcp",
			ranked: true,
		});
		expect(result).toEqual({ outcome: "rejected", reason: "strong_auth" });
	});

	it("matches even a still-open socket in a ranked room — a backgrounded mobile client leaves a half-open socket that never reports closed, so the by-name reconnect must take it over (last-join-wins)", () => {
		const p = player({ closed: false });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			remoteAddress: "9.9.9.9",
			transport: "tcp",
			ranked: true,
		});
		expect(result).toEqual({ outcome: "takeover", player: p });
	});

	it("takes over a still-open casual TCP socket when the new connection shares its source IP", () => {
		const p = player({ closed: false });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			remoteAddress: "1.1.1.1",
			transport: "tcp",
			ranked: false,
		});
		expect(result).toEqual({ outcome: "takeover", player: p });
	});

	it("still takes over a casual TCP seat when the old socket already reported closed", () => {
		const p = player({ closed: true });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			remoteAddress: "1.1.1.1",
			transport: "tcp",
			ranked: false,
		});
		expect(result).toEqual({ outcome: "takeover", player: p });
	});

	it("rejects a casual reconnect from a different source IP", () => {
		const p = player();
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			remoteAddress: "2.2.2.2",
			transport: "tcp",
			ranked: false,
		});
		expect(result).toEqual({ outcome: "rejected", reason: "ip_mismatch" });
	});

	it("rejects a casual reconnect whose original seat is held by a WebSocket", () => {
		const p = player({ transport: "websocket" });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			remoteAddress: "1.1.1.1",
			transport: "tcp",
			ranked: false,
		});
		expect(result).toEqual({ outcome: "rejected", reason: "transport_mismatch" });
	});

	it("rejects a casual reconnect arriving over a WebSocket", () => {
		const p = player();
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			remoteAddress: "1.1.1.1",
			transport: "websocket",
			ranked: false,
		});
		expect(result).toEqual({ outcome: "rejected", reason: "transport_mismatch" });
	});

	it("returns player_not_found when the name does not match", () => {
		const p = player({ name: "Other" });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			remoteAddress: "1.1.1.1",
			transport: "tcp",
			ranked: true,
		});
		expect(result).toEqual({ outcome: "rejected", reason: "player_not_found" });
	});

	it("returns player_not_found when nobody is seated", () => {
		const result = findReconnectingPlayer({
			players: [],
			name: "Jaden",
			remoteAddress: "1.1.1.1",
			transport: "tcp",
			ranked: true,
		});
		expect(result).toEqual({ outcome: "rejected", reason: "player_not_found" });
	});

	it("compares the stable cached IP, not the old socket's possibly-stale address", () => {
		const p = player({
			// old socket lost its address after close, but the player remembers it
			socketRemoteAddress: null,
			ipAddress: "1.1.1.1",
			closed: true,
		});
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			remoteAddress: "1.1.1.1",
			transport: "tcp",
			ranked: false,
		});
		expect(result).toEqual({ outcome: "takeover", player: p });
	});
});
