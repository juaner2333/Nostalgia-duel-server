import { dataSource } from "../../../../evolution-types/src/data-source";
import { MatchDeckRepository, MatchDeckDetails } from "../../domain/MatchDeckRepository";

export class MatchDeckPostgresRepository implements MatchDeckRepository {
	async findByMatchId(formatId: string, matchId: string): Promise<MatchDeckDetails | null> {
		const sql = `
			SELECT
				m.id AS "matchId",
				m.format_id AS "formatId",
				m.date AS "date",
				m.player_names AS "playerNames",
				m.opponent_names AS "opponentNames",
				md.main_cards AS "mainCards",
				md.extra_cards AS "extraCards",
				md.side_cards AS "sideCards"
			FROM matches m
			JOIN match_decks md ON md.match_id = m.id AND md.format_id = m.format_id
			WHERE m.id = $1
			  AND m.format_id = $2
			  AND m.anulled = false
			  AND m.deleted_at IS NULL
			LIMIT 1
		`;

		const rows: Array<{
			matchId: string;
			formatId: string;
			date: Date;
			playerNames: string | string[] | null;
			opponentNames: string | string[] | null;
			mainCards: number[];
			extraCards: number[];
			sideCards: number[] | null;
		}> = await dataSource.query(sql, [matchId, formatId]);

		if (rows.length === 0) {
			return null;
		}

		const r = rows[0];
		const p1 = Array.isArray(r.playerNames)
			? (r.playerNames[0] ?? "玩家")
			: (r.playerNames ?? "").split(",")[0]?.trim() || "玩家";
		const p2 = Array.isArray(r.opponentNames)
			? (r.opponentNames[0] ?? "对手")
			: (r.opponentNames ?? "").split(",")[0]?.trim() || "对手";

		return {
			matchId: r.matchId,
			formatId: r.formatId,
			date: new Date(r.date),
			playerName: p1,
			opponentName: p2,
			mainCards: r.mainCards,
			extraCards: r.extraCards,
			sideCards: r.sideCards,
			completeness: r.sideCards === null ? "partial" : "complete",
		};
	}
}
