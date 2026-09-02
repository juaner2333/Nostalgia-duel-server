import { randomUUID } from "crypto";
import { Logger } from "@shared/logger/domain/Logger";
import { GameOverDomainEvent } from "@shared/room/domain/match/domain/domain-events/GameOverDomainEvent";
import { UserProfileRepository } from "@shared/user-profile/domain/UserProfileRepository";
import { calculateBeijingSeason } from "src/utils/calculateBeijingSeason";
import { dataSource } from "../../../evolution-types/src/data-source";
import { MatchResumeEntity } from "../../../evolution-types/src/entities/MatchResumeEntity";
import { DuelReplayEntity } from "../../../evolution-types/src/entities/DuelReplayEntity";
import { DuelResumeEntity } from "../../../evolution-types/src/entities/DuelResumeEntity";
import { PlayerStatsEntity } from "../../../evolution-types/src/entities/PlayerStatsEntity";
import { Player } from "@shared/player/domain/Player";

export class RankedMatchPersistenceService {
	constructor(
		private readonly logger: Logger,
		private readonly userProfileRepository: UserProfileRepository,
	) {}

	async persist(event: GameOverDomainEvent): Promise<void> {
		if (!event.data.ranked) {
			this.logger.info("Match is non-ranked; skipping ranked persistence.");
			return;
		}

		const formatId = event.data.formatId ?? "1109";
		const season = calculateBeijingSeason(event.data.date);
		const gameId = randomUUID();
		const players = event.data.players.map((item) => new Player(item));
		const replays = event.data.replays ?? [];

		// Pre-resolve users
		const resolvedPlayers: Array<{
			player: Player;
			userId: string;
			points: number;
		}> = [];

		for (const player of players) {
			const userProfile = await this.userProfileRepository.findByUsername(player.name);
			if (!userProfile) {
				this.logger.warn(`User profile not found for player: ${player.name}`);
				continue;
			}
			resolvedPlayers.push({
				player,
				userId: userProfile.id,
				points: player.calculateMatchPoints(),
			});
		}

		if (resolvedPlayers.length === 0) {
			return;
		}

		// Pre-generate replay IDs so both attempts use identical IDs
		const replayEntries = replays.map((r) => ({
			id: randomUUID(),
			duelIndex: r.duelIndex,
			replayData: r.replayData,
			startedAt: r.startedAt,
			endedAt: r.endedAt,
		}));

		const executeTransaction = async (): Promise<void> => {
			await dataSource.transaction(async (manager) => {
				// 1. Write duel_replays
				for (const r of replayEntries) {
					const replayEntity = manager.create(DuelReplayEntity, {
						id: r.id,
						gameId,
						duelIndex: r.duelIndex,
						formatId,
						banListName: event.data.banListName,
						banListHash: event.data.banListHash.toString(),
						replayData: r.replayData,
						startedAt: r.startedAt,
						endedAt: r.endedAt,
					});
					await manager.save(replayEntity);
				}

				// 2. Write matches, duels, player_stats
				for (const { player, userId, points } of resolvedPlayers) {
					const playerNames = players
						.filter((item) => item.team === player.team)
						.map((element) => element.name);
					const opponentNames = players
						.filter((item) => item.team !== player.team)
						.map((element) => element.name);
					const playerIds = players
						.filter((item) => item.team === player.team)
						.map((element) => element.id)
						.filter((id): id is string => id !== null);
					const opponentIds = players
						.filter((item) => item.team !== player.team)
						.map((element) => element.id)
						.filter((id): id is string => id !== null);

					const matchEntity = manager.create(MatchResumeEntity, {
						id: randomUUID(),
						userId,
						gameId,
						formatId,
						bestOf: event.data.bestOf,
						playerNames,
						opponentNames,
						playerIds: playerIds.length > 0 ? playerIds : null,
						opponentIds: opponentIds.length > 0 ? opponentIds : null,
						date: event.data.date,
						banListName: event.data.banListName,
						banListHash: event.data.banListHash.toString(),
						playerScore: player.wins,
						opponentScore: player.losses,
						winner: player.winner,
						season,
						points,
					});
					const savedMatch = await manager.save(matchEntity);

					// Duels
					for (let i = 0; i < player.games.length; i++) {
						const game = player.games[i];
						const matchingReplay = replayEntries.find((r) => r.duelIndex === i + 1);
						const replayId = matchingReplay ? matchingReplay.id : randomUUID();
						const duelEntity = manager.create(DuelResumeEntity, {
							id: randomUUID(),
							userId,
							gameId,
							replayId,
							playerNames,
							opponentNames,
							date: event.data.date,
							banListName: event.data.banListName,
							banListHash: event.data.banListHash.toString(),
							result: game.result,
							turns: game.turns,
							matchId: savedMatch.id,
							season,
							ipAddress: game.ipAddress,
						});
						await manager.save(duelEntity);
					}

					// PlayerStats upsert
					let stats = await manager.findOne(PlayerStatsEntity, {
						where: { userId, formatId, season },
					});
					if (!stats) {
						stats = manager.create(PlayerStatsEntity, {
							id: randomUUID(),
							userId,
							formatId,
							banListName: event.data.banListName,
							season,
							wins: player.winner ? 1 : 0,
							losses: player.winner ? 0 : 1,
							points,
						});
					} else {
						if (player.winner) {
							stats.wins += 1;
						} else {
							stats.losses += 1;
						}
						stats.points += points;
					}
					await manager.save(stats);
				}
			});
		};

		try {
			await executeTransaction();
			this.logger.info(`Successfully persisted ranked match gameId=${gameId}`);
		} catch (firstErr) {
			this.logger.warn(
				`First persistence attempt failed for gameId=${gameId}: ${firstErr}. Retrying once...`,
			);
			try {
				await executeTransaction();
				this.logger.info(`Retry succeeded for gameId=${gameId}`);
			} catch (secondErr) {
				this.logger.error(`Second persistence attempt failed for gameId=${gameId}: ${secondErr}`);
			}
		}
	}
}
