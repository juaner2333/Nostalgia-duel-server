import { dataSource } from "../../../../../evolution-types/src/data-source";
import { GetReplaysFilter, ReplayRepository } from "../../domain/ReplayRepository";
import { ReplayItem, ReplayFile } from "../../domain/Replay";

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
				SELECT 1 FROM matches m WHERE m.game_id = dr.game_id AND m.anulled = true
			  )
		`;

		if (filter.search && filter.search.trim().length > 0) {
			params.push(`%${escapeLike(filter.search.trim())}%`);
			whereClause += `
				AND EXISTS (
					SELECT 1 FROM duels d
					WHERE d.replay_id = dr.id
					  AND (d.player_names ILIKE $${params.length} OR d.opponent_names ILIKE $${params.length})
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

		// Data query
		const dataParams = [...params, filter.pageSize, offset];
		const dataSql = `
			SELECT
				dr.id AS "replayId",
				dr.ended_at AS "endedAt",
				octet_length(dr.replay_data) AS "size",
				(SELECT d.player_names FROM duels d WHERE d.replay_id = dr.id LIMIT 1) AS "playerNames",
				(SELECT d.opponent_names FROM duels d WHERE d.replay_id = dr.id LIMIT 1) AS "opponentNames"
			FROM duel_replays dr
			${whereClause}
			ORDER BY dr.ended_at DESC, dr.id DESC
			LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
		`;

		const rows: Array<{
			replayId: string;
			endedAt: Date;
			size: number | string;
			playerNames: string | null;
			opponentNames: string | null;
		}> = await dataSource.query(dataSql, dataParams);

		const replays: ReplayItem[] = rows.map((r) => {
			const p1 = (r.playerNames ?? "").split(",")[0]?.trim() || "未知玩家";
			const p2 = (r.opponentNames ?? "").split(",")[0]?.trim() || "未知玩家";
			return {
				replayId: r.replayId,
				endedAt: formatToBeijingTimeString(new Date(r.endedAt)),
				player1Name: p1,
				player2Name: p2,
				size: Number(r.size ?? 0),
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
