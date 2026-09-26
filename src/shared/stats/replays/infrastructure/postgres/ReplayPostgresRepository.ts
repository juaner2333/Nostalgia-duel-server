import { dataSource } from "../../../../../evolution-types/src/data-source";
import { GetReplaysFilter, ReplayRepository } from "../../domain/ReplayRepository";
import { ReplayItem, ReplayFile, ReplayPlayerInfo } from "../../domain/Replay";

export function formatToBeijingTimeString(date: Date): string {
	const formatter = new Intl.DateTimeFormat("zh-CN", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	const parts = formatter.formatToParts(date);
	let year = "",
		month = "",
		day = "",
		hour = "",
		minute = "",
		second = "";
	for (const p of parts) {
		if (p.type === "year") year = p.value;
		else if (p.type === "month") month = p.value;
		else if (p.type === "day") day = p.value;
		else if (p.type === "hour") hour = p.value;
		else if (p.type === "minute") minute = p.value;
		else if (p.type === "second") second = p.value;
	}
	return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function escapeLike(str: string): string {
	return str.replace(/[%_\\]/g, "\\$&");
}

export class ReplayPostgresRepository implements ReplayRepository {
	async getReplayList(filter: GetReplaysFilter): Promise<{ replays: ReplayItem[]; total: number }> {
		const offset = (filter.page - 1) * filter.pageSize;
		const params: any[] = [filter.formatId];

		let whereClause = `
			WHERE dr.format_id = $1
			  AND NOT EXISTS (
				SELECT 1 FROM matches m
				WHERE m.game_id = dr.game_id
				  AND (m.anulled = true OR m.deleted_at IS NOT NULL)
			  )
		`;

		if (filter.search && filter.search.trim().length > 0) {
			params.push(`%${escapeLike(filter.search.trim())}%`);
			whereClause += `
				AND EXISTS (
					SELECT 1 FROM duels d
					WHERE d.replay_id = dr.id
					  AND d.deleted_at IS NULL
					  AND (d.player_names ILIKE $${params.length} OR d.opponent_names ILIKE $${params.length})
				)
			`;
		}

		if (filter.deckTypeCode && filter.deckTypeCode.trim().length > 0) {
			params.push(filter.deckTypeCode.trim());
			whereClause += `
				AND EXISTS (
					SELECT 1
					FROM duels d
					JOIN matches m ON m.id = d.match_id AND m.format_id = dr.format_id AND m.anulled = false AND m.deleted_at IS NULL
					JOIN match_decks md ON md.match_id = m.id AND md.format_id = dr.format_id
					WHERE d.replay_id = dr.id
					  AND d.deleted_at IS NULL
					  AND md.deck_type_code = $${params.length}
				)
			`;
		}

		// Count query
		const countSql = `
			SELECT COUNT(dr.id)::int AS total
			FROM duel_replays dr
			${whereClause}
		`;
		const countResult: Array<{ total: number | string }> = await dataSource.query(countSql, params);
		const total = Number(countResult[0]?.total ?? 0);

		if (total === 0) {
			return { replays: [], total: 0 };
		}

		// Data query (fetching only identifiers and metadata; no replay_data bytes or card arrays)
		const dataParams = [...params, filter.pageSize, offset];
		const dataSql = `
			SELECT
				dr.id AS "replayId",
				dr.duel_index AS "duelIndex",
				dr.ended_at AS "endedAt",
				octet_length(dr.replay_data) AS "size"
			FROM duel_replays dr
			${whereClause}
			ORDER BY dr.ended_at DESC, dr.id DESC
			LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
		`;

		const rows: Array<{
			replayId: string;
			duelIndex: number | string;
			endedAt: Date;
			size: number | string;
		}> = await dataSource.query(dataSql, dataParams);

		if (rows.length === 0) {
			return { replays: [], total };
		}

		const replayIds = rows.map((r) => r.replayId);

		// Batch query to resolve player perspectives and initial deck snapshots
		const duelsSql = `
			SELECT
				d.replay_id AS "replayId",
				d.id AS "duelId",
				d.user_id AS "userId",
				d.match_id AS "matchId",
				d.player_names AS "playerNames",
				d.opponent_names AS "opponentNames",
				d.result AS "result",
				m.format_id AS "matchFormatId",
				m.anulled AS "matchAnulled",
				m.deleted_at AS "matchDeletedAt",
				md.deck_type_code AS "deckTypeCode",
				dt.name_zh AS "deckTypeNameZh",
				(md.side_cards IS NULL) AS "isSideNull",
				md.snapshot_source AS "snapshotSource"
			FROM duels d
			JOIN matches m ON m.id = d.match_id
			LEFT JOIN match_decks md ON md.match_id = m.id AND md.format_id = m.format_id
			LEFT JOIN deck_types dt ON dt.format_id = md.format_id AND dt.code = md.deck_type_code
			WHERE d.replay_id = ANY($1)
			  AND d.deleted_at IS NULL
			ORDER BY d.id ASC
		`;

		const duelRows: Array<{
			replayId: string;
			duelId: string;
			userId: string;
			matchId: string;
			playerNames: string | null;
			opponentNames: string | null;
			result: string | null;
			matchFormatId: string;
			matchAnulled: boolean;
			matchDeletedAt: Date | null;
			deckTypeCode: string | null;
			deckTypeNameZh: string | null;
			isSideNull: boolean | null;
			snapshotSource: string | null;
		}> = await dataSource.query(duelsSql, [replayIds]);

		const duelsByReplay = new Map<string, typeof duelRows>();
		for (const dr of duelRows) {
			let list = duelsByReplay.get(dr.replayId);
			if (!list) {
				list = [];
				duelsByReplay.set(dr.replayId, list);
			}
			list.push(dr);
		}

		const replays: ReplayItem[] = rows.map((r) => {
			const replayDuels = duelsByReplay.get(r.replayId) ?? [];
			let p1Name = "未知玩家";
			let p2Name = "未知玩家";
			let player1Info: ReplayPlayerInfo;
			let player2Info: ReplayPlayerInfo;

			const isUnambiguousPair =
				replayDuels.length === 2 &&
				replayDuels[0].userId !== replayDuels[1].userId &&
				replayDuels[0].matchId !== replayDuels[1].matchId &&
				replayDuels[0].matchFormatId === filter.formatId &&
				replayDuels[1].matchFormatId === filter.formatId &&
				!replayDuels[0].matchAnulled &&
				!replayDuels[1].matchAnulled &&
				replayDuels[0].matchDeletedAt == null &&
				replayDuels[1].matchDeletedAt == null;

			let winner: string | null = null;

			if (isUnambiguousPair) {
				const d1 = replayDuels[0];
				const d2 = replayDuels[1];
				p1Name = (d1.playerNames ?? "").split(",")[0]?.trim() || "未知玩家";
				p2Name = (d2.playerNames ?? "").split(",")[0]?.trim() || "未知玩家";

				if (d1.result === "winner") {
					winner = p1Name;
				} else if (d2.result === "winner") {
					winner = p2Name;
				} else if (d1.result === "deuce" || d2.result === "deuce") {
					winner = "平局";
				}

				player1Info = {
					name: p1Name,
					deckTypeCode: d1.deckTypeCode ?? null,
					deckTypeNameZh: d1.deckTypeNameZh ?? null,
					deckCompleteness: d1.deckTypeCode ? (d1.isSideNull ? "partial" : "complete") : null,
					deckDownloadUrl: d1.deckTypeCode
						? `/api/ladder/${filter.formatId}/matches/${d1.matchId}/deck`
						: null,
				};

				player2Info = {
					name: p2Name,
					deckTypeCode: d2.deckTypeCode ?? null,
					deckTypeNameZh: d2.deckTypeNameZh ?? null,
					deckCompleteness: d2.deckTypeCode ? (d2.isSideNull ? "partial" : "complete") : null,
					deckDownloadUrl: d2.deckTypeCode
						? `/api/ladder/${filter.formatId}/matches/${d2.matchId}/deck`
						: null,
				};
			} else {
				if (replayDuels.length > 0) {
					p1Name = (replayDuels[0].playerNames ?? "").split(",")[0]?.trim() || "未知玩家";
					p2Name = (replayDuels[0].opponentNames ?? "").split(",")[0]?.trim() || "未知玩家";

					const winnerDuel = replayDuels.find((d) => d.result === "winner");
					if (winnerDuel) {
						winner = (winnerDuel.playerNames ?? "").split(",")[0]?.trim() || null;
					} else {
						const loserDuel = replayDuels.find((d) => d.result === "loser");
						if (loserDuel) {
							winner = (loserDuel.opponentNames ?? "").split(",")[0]?.trim() || null;
						} else if (replayDuels.some((d) => d.result === "deuce")) {
							winner = "平局";
						}
					}
				}
				player1Info = {
					name: p1Name,
					deckTypeCode: null,
					deckTypeNameZh: null,
					deckCompleteness: null,
					deckDownloadUrl: null,
				};
				player2Info = {
					name: p2Name,
					deckTypeCode: null,
					deckTypeNameZh: null,
					deckCompleteness: null,
					deckDownloadUrl: null,
				};
			}

			return {
				replayId: r.replayId,
				duelIndex: Number(r.duelIndex ?? 1),
				endedAt: formatToBeijingTimeString(new Date(r.endedAt)),
				player1Name: p1Name,
				player2Name: p2Name,
				winner,
				size: Number(r.size ?? 0),
				players: [player1Info, player2Info],
			};
		});

		return { replays, total };
	}

	async getReplayById(formatId: string, replayId: string): Promise<ReplayFile | null> {
		const sql = `
			SELECT
				dr.id AS "replayId",
				dr.format_id AS "formatId",
				dr.ended_at AS "endedAt",
				dr.replay_data AS "replayData",
				(SELECT d.player_names FROM duels d WHERE d.replay_id = dr.id LIMIT 1) AS "playerNames",
				(SELECT d.opponent_names FROM duels d WHERE d.replay_id = dr.id LIMIT 1) AS "opponentNames"
			FROM duel_replays dr
			WHERE dr.id = $1 AND dr.format_id = $2
			LIMIT 1
		`;

		const rows: Array<{
			replayId: string;
			formatId: string;
			endedAt: Date;
			replayData: Buffer;
			playerNames: string | null;
			opponentNames: string | null;
		}> = await dataSource.query(sql, [replayId, formatId]);

		if (rows.length === 0) {
			return null;
		}

		const r = rows[0];
		const p1 = (r.playerNames ?? "").split(",")[0]?.trim() || "未知玩家";
		const p2 = (r.opponentNames ?? "").split(",")[0]?.trim() || "未知玩家";

		return {
			replayId: r.replayId,
			formatId: r.formatId,
			endedAt: new Date(r.endedAt),
			player1Name: p1,
			player2Name: p2,
			replayData: r.replayData,
		};
	}
}
