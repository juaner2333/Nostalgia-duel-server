import { MatchResume } from "./MatchResume";
import { DuelResume } from "../duel-resume/domain/DuelResume";
import { PlayerStats } from "../../player-stats/domain/PlayerStats";
import { calculateBeijingSeason } from "src/utils/calculateBeijingSeason";

describe("RankedPersistenceModels", () => {
	describe("calculateBeijingSeason", () => {
		it("calculates integer YYYYMM based on Asia/Shanghai timezone at month boundary", () => {
			// 2026-08-31 23:59:59 Beijing time = 2026-08-31 15:59:59 UTC
			const augEnd = new Date("2026-08-31T15:59:59.000Z");
			expect(calculateBeijingSeason(augEnd)).toBe(202608);

			// 2026-09-01 00:00:00 Beijing time = 2026-08-31 16:00:00 UTC
			const sepStart = new Date("2026-08-31T16:00:00.000Z");
			expect(calculateBeijingSeason(sepStart)).toBe(202609);
		});
	});

	describe("MatchResume with formatId and stable gameId", () => {
		it("creates a MatchResume with formatId, stable gameId, and net points", () => {
			const match = MatchResume.create({
				id: "match-1",
				userId: "user-1",
				gameId: "00000000-0000-0000-0000-000000000001",
				formatId: "1103",
				bestOf: 3,
				playerNames: ["PlayerA"],
				opponentNames: ["PlayerB"],
				date: new Date("2026-09-01T12:00:00Z"),
				banListName: "1103",
				banListHash: "0",
				playerScore: 2,
				opponentScore: 0,
				winner: true,
				season: 202609,
				points: 2, // 2:0 => +2
				playerIds: ["user-1"],
				opponentIds: ["user-2"],
			});

			expect(match.formatId).toBe("1103");
			expect(match.gameId).toBe("00000000-0000-0000-0000-000000000001");
			expect(match.points).toBe(2);
			expect(match.season).toBe(202609);
		});
	});

	describe("DuelResume with replayId", () => {
		it("creates a DuelResume linking to a shared replayId", () => {
			const duel = DuelResume.create({
				id: "duel-1",
				userId: "user-1",
				gameId: "00000000-0000-0000-0000-000000000001",
				replayId: "00000000-0000-0000-0000-000000000002",
				playerNames: ["PlayerA"],
				opponentNames: ["PlayerB"],
				date: new Date("2026-09-01T12:00:00Z"),
				banListName: "1103",
				banListHash: "0",
				result: "WIN",
				turns: 5,
				matchId: "match-1",
				season: 202609,
				ipAddress: "127.0.0.1",
			});

			expect(duel.replayId).toBe("00000000-0000-0000-0000-000000000002");
			expect(duel.gameId).toBe("00000000-0000-0000-0000-000000000001");
		});
	});

	describe("PlayerStats format isolation and 0 initial score", () => {
		it("initializes monthly stats from 0 points and updates with net points", () => {
			const stats = PlayerStats.initialize({
				userId: "user-1",
				formatId: "1109",
				banListName: "1109",
				season: 202609,
			});

			expect(stats.points).toBe(0);
			expect(stats.wins).toBe(0);
			expect(stats.losses).toBe(0);
			expect(stats.formatId).toBe("1109");
			expect(stats.season).toBe(202609);

			// First match 2:0 (+2 net points)
			stats.addPoints(2);
			stats.increaseWins();

			expect(stats.points).toBe(2);
			expect(stats.wins).toBe(1);
			expect(stats.losses).toBe(0);

			// Second match 1:2 (-1 net points)
			stats.addPoints(-1);
			stats.increaseLosses();

			expect(stats.points).toBe(1);
			expect(stats.wins).toBe(1);
			expect(stats.losses).toBe(1);
		});
	});
});
