import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";

@Entity({
    name: "unranked_duels",
})
export class UnrankedDuelEntity {
    @PrimaryColumn()
    id: string;

    @Column({ name: "game_id" })
    gameId: string;

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
    turns: number;

    @Column({ name: "match_id" })
    matchId: string;

    @Column()
    season: number;

    @Column({ name: "ip_address", type: "varchar", nullable: true, default: null })
    ipAddress: string | null;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
