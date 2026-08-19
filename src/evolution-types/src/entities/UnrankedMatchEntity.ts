import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";

@Entity({
    name: "unranked_matches",
})
export class UnrankedMatchEntity {
    @PrimaryColumn()
    id: string;

    @Column({ name: "game_id" })
    gameId: string;

    @Column({ name: "best_of" })
    bestOf: number;

    @Column({ name: "player_names", type: "simple-array" })
    playerNames: string[];

    @Column({ name: "opponent_names", type: "simple-array" })
    opponentNames: string[];

    @Column()
    date: Date;

    @Column({ name: "ban_list_name" })
    banListName: string;

    @Column({ name: "ban_list_hash" })
    banListHash: string;

    @Column({ name: "team_0_score" })
    team0Score: number;

    @Column({ name: "team_1_score" })
    team1Score: number;

    @Column({ name: "winner_team" })
    winnerTeam: number;

    @Column()
    season: number;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
