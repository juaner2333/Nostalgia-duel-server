import { YgoClient } from "@shared/client/domain/YgoClient";
import { Logger } from "@shared/logger/domain/Logger";
import { ISocket, SocketTransport } from "@shared/socket/domain/ISocket";

/**
 * Finds the player that a by-name JOIN is reconnecting to, while a duel is
 * already in progress. This is the WEAK reconnect path used by external
 * clients; the evolution client reconnects through its token instead.
 *
 * A reconnection is granted ONLY when every guard holds:
 *   - the target is NOT strong-auth: ticket players reconnect through their
 *     single-use token, so they are unreachable here (closes the hijack of a
 *     verified player by name, with a stolen PIN or another ticket).
 *   - the name matches.
 *
 * The result distinguishes WHY a reconnect was denied (`ReconnectRejectionReason`)
 * so state handlers can log a stable reason instead of a bare null, without
 * pushing logging into this pure domain decision.
 *
 * The result is a discriminated union: `{ outcome: "takeover"; player }` when the
 * new connection may take the seat, or `{ outcome: "rejected"; reason }` with a
 * stable reason string (`player_not_found`, `strong_auth`, `transport_mismatch`).
 */

export type ReconnectRejectionReason = "player_not_found" | "strong_auth" | "transport_mismatch";

export type ReconnectEligibility =
	| { outcome: "takeover"; player: YgoClient }
	| { outcome: "rejected"; reason: ReconnectRejectionReason };

/**
 * Eligibility order is fixed:
 * seat exists -> exact name -> not strong-auth -> (casual only) both sides plain
 * TCP -> takeover (last join wins). The old socket's `closed` state and source
 * IP are never read.
 *
 * Casual rooms allow anonymous TCP clients to reconnect by name across IP changes:
 * a still-open, half-open or closed old TCP socket does not block the takeover.
 * WebSocket clients (either side) never take a seat through the anonymous TCP path —
 * they reconnect via their token (EXPRESS_RECONNECT).
 *
 * Ranked rooms keep their existing behavior: they are bound to authenticated
 * identities (resolveUserId), so no transport check is applied here.
 */
export function findReconnectingPlayer(params: {
	players: YgoClient[];
	name: string;
	transport: SocketTransport;
	ranked: boolean;
}): ReconnectEligibility {
	const candidate = params.players.find((client) => client.name === params.name);
	if (!candidate) {
		return { outcome: "rejected", reason: "player_not_found" };
	}
	if (candidate.isStrongAuth) {
		return { outcome: "rejected", reason: "strong_auth" };
	}

	if (!params.ranked) {
		if (candidate.socket.transport !== "tcp" || params.transport !== "tcp") {
			return { outcome: "rejected", reason: "transport_mismatch" };
		}
	}

	return { outcome: "takeover", player: candidate };
}

/**
 * Unified structured reconnect-judgement log used by the by-name JOIN path of
 * every started phase (RPS / choosing order / dueling / side decking). Records
 * stable identifiers, decision metadata and the involved player names in plain
 * text (so a seat miss can be checked against the seated players on the next
 * look) — never the reconnection token, full PlayerInfo/JoinGame frames or
 * deck hex payloads. Logging is diagnostic only and never influences the
 * eligibility decision above.
 */
export function logReconnectJudgement(params: {
	logger: Logger;
	result: "takeover" | "rejected";
	reason?: ReconnectRejectionReason;
	room: { id: number; formatId: string; externalRoomId: string; duelState: string };
	socket: ISocket;
	previousSocket?: ISocket;
	/** Plain-text player name carried by the JOIN's PlayerInfo frame. */
	name: string;
	/** Plain-text names of every seated player in the room at judgement time. */
	roomPlayers: string[];
}): void {
	params.logger.info("reconnect_judgement", {
		result: params.result,
		reason: params.reason,
		roomId: params.room.id,
		formatId: params.room.formatId,
		externalRoomId: params.room.externalRoomId,
		state: params.room.duelState,
		socketId: params.socket.id,
		socketTransport: params.socket.transport,
		previousSocketId: params.previousSocket?.id,
		previousSocketTransport: params.previousSocket?.transport,
		name: params.name,
		roomPlayers: params.roomPlayers,
	});
}
