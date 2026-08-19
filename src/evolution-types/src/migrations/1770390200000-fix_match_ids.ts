import { MigrationInterface, QueryRunner } from "typeorm";
import { MatchResumeEntity } from "../entities/MatchResumeEntity";

export class FixMatchIds1770390200000 implements MigrationInterface {
    name = "FixMatchIds1770390200000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        // We use the EntityManager to interact with the entities
        const manager = queryRunner.manager;

        // 1. Find matches with missing opponent_ids
        // Using raw query for speed to get IDs first, or just find() if volume isn't massive.
        // Let's use finding with chunking similar to the script but adapted for migration context.

        // Fetch all problematic matches to get their game_ids
        const problematicMatches = await manager.getRepository(MatchResumeEntity).createQueryBuilder("m")
            .select(["m.gameId"])
            .where("m.opponentIds IS NULL")
            .getMany();

        if (problematicMatches.length === 0) {
            console.log("No matches to base fix on.");
            return;
        }

        const uniqueGameIds = [...new Set(problematicMatches.map(m => m.gameId).filter(id => id))];
        console.log(`Found ${uniqueGameIds.length} unique game IDs to process.`);

        const chunkSize = 100;
        let updatedCount = 0;

        for (let i = 0; i < uniqueGameIds.length; i += chunkSize) {
            const batchGameIds = uniqueGameIds.slice(i, i + chunkSize);

            const allRelatedMatches = await manager.getRepository(MatchResumeEntity).createQueryBuilder("m")
                .where("m.gameId IN (:...ids)", { ids: batchGameIds })
                .getMany();

            const matchesByGameId: Record<string, MatchResumeEntity[]> = {};
            allRelatedMatches.forEach(m => {
                if (!matchesByGameId[m.gameId]) {
                    matchesByGameId[m.gameId] = [];
                }
                matchesByGameId[m.gameId].push(m);
            });

            for (const gameId of batchGameIds) {
                const group = matchesByGameId[gameId];
                if (!group || group.length < 2) continue;

                // Strategy: Name Matching
                const teamMap = new Map<string, string[]>();

                // Build map
                for (const match of group) {
                    const teamKey = match.playerNames.slice().sort().join("::");
                    if (!teamMap.has(teamKey)) {
                        teamMap.set(teamKey, []);
                    }
                    const currentList = teamMap.get(teamKey)!;
                    if (!currentList.includes(match.userId)) {
                        currentList.push(match.userId);
                    }
                }

                // Update rows
                for (const match of group) {
                    let changed = false;
                    const playerTeamKey = match.playerNames.slice().sort().join("::");
                    const startPlayerIds = teamMap.get(playerTeamKey);

                    if (startPlayerIds && startPlayerIds.length > 0) {
                        match.playerIds = startPlayerIds;
                        changed = true;
                    }

                    const opponentTeamKey = match.opponentNames.slice().sort().join("::");
                    const opponentIds = teamMap.get(opponentTeamKey);

                    if (opponentIds && opponentIds.length > 0) {
                        match.opponentIds = opponentIds;
                        changed = true;
                    }

                    if (changed) {
                        await manager.save(match);
                        updatedCount++;
                    }
                }
            }
            console.log(`Processed batch ${i} - ${i + chunkSize}`);
        }
        console.log(`Migration finished. Updated ${updatedCount} rows.`);

    }

    public async down(): Promise<void> {
        // It's hard to reverse data recovery without a backup.
        // We could technically set them back to null where they match specific criteria, but usually data fixes don't have simple downs.
        console.log("Down migration for data fix not implemented (destructive operation).");
    }
}
