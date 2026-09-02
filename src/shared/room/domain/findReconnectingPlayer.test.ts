import { YgoClient } from "@shared/client/domain/YgoClient";
import { SocketTransport } from "@shared/socket/domain/ISocket";

import { findReconnectingPlayer } from "./findReconnectingPlayer";

const player = (
	overrides: Partial<{
		id: string | null;
		name: string;
		isStrongAuth: boolean;
		closed: boolean;
		ipAddress: string | null;
		transport: SocketTransport;
	}> = {},
): YgoClient =>
	({
		id: overrides.id ?? null,
		name: overrides.name ?? "Jaden",
		isStrongAuth: overrides.isStrongAuth ?? false,
		ipAddress: overrides.ipAddress ?? "1.1.1.1",
		socket: {
			closed: overrides.closed ?? true,
			transport: overrides.transport ?? "tcp",
		},
	}) as unknown as YgoClient;

describe("findReconnectingPlayer", () => {
	it("matches a disconnected legacy player by name in a ranked room", () => {
		const p = player({ id: "u1" });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			transport: "tcp",
			ranked: true,
			userId: "u1",
		});
		expect(result).toEqual({ outcome: "takeover", player: p });
	});

	it("NEVER matches a strong-auth (ticket) player — it is unreachable by name", () => {
		const p = player({ isStrongAuth: true });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			transport: "tcp",
			ranked: true,
		});
		expect(result).toEqual({ outcome: "rejected", reason: "strong_auth" });
	});

	it("matches even a still-open socket in a ranked room — a backgrounded mobile client leaves a half-open socket that never reports closed, so the by-name reconnect must take it over (last-join-wins)", () => {
		const p = player({ id: "u1", closed: false });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			transport: "tcp",
			ranked: true,
			userId: "u1",
		});
		expect(result).toEqual({ outcome: "takeover", player: p });
	});

	it("rejects an anonymous same-name joiner in a ranked room — spectators never take over seats", () => {
		const p = player({ id: "u1" });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			transport: "tcp",
			ranked: true,
			userId: undefined,
		});
		expect(result).toEqual({ outcome: "rejected", reason: "user_mismatch" });
	});

	it("rejects a ranked reconnect when user IDs do not match", () => {
		const p = player({ id: "u1" });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			transport: "tcp",
			ranked: true,
			userId: "u2",
		});
		expect(result).toEqual({ outcome: "rejected", reason: "user_mismatch" });
	});

	it("takes over a still-open casual TCP socket", () => {
		const p = player({ closed: false });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
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
			transport: "tcp",
			ranked: false,
		});
		expect(result).toEqual({ outcome: "takeover", player: p });
	});

	it("takes over a casual TCP seat regardless of source IP (cross-IP takeover)", () => {
		const p = player({ ipAddress: "1.1.1.1" });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
			transport: "tcp",
			ranked: false,
		});
		expect(result).toEqual({ outcome: "takeover", player: p });
	});

	it("rejects a casual reconnect whose original seat is held by a WebSocket", () => {
		const p = player({ transport: "websocket" });
		const result = findReconnectingPlayer({
			players: [p],
			name: "Jaden",
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
			transport: "tcp",
			ranked: true,
		});
		expect(result).toEqual({ outcome: "rejected", reason: "player_not_found" });
	});

	it("returns player_not_found when nobody is seated", () => {
		const result = findReconnectingPlayer({
			players: [],
			name: "Jaden",
			transport: "tcp",
			ranked: true,
		});
		expect(result).toEqual({ outcome: "rejected", reason: "player_not_found" });
	});
});
