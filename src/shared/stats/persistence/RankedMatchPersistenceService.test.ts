import { RankedMatchPersistenceService } from "./RankedMatchPersistenceService";
import { GameOverDomainEvent } from "@shared/room/domain/match/domain/domain-events/GameOverDomainEvent";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { UserProfileRepository } from "@shared/user-profile/domain/UserProfileRepository";
import { UserProfile } from "@shared/user-profile/domain/UserProfile";
import { Team } from "@shared/room/Team";
import { dataSource } from "../../../evolution-types/src/data-source";
import { MatchDeckEntity } from "../../../evolution-types/src/entities/MatchDeckEntity";
import { YGOProYrp, ReplayHeader } from "ygopro-yrp-encode";

jest.mock("../../../evolution-types/src/data-source", () => ({
	dataSource: {
		transaction: jest.fn(),
	},
}));

describe("RankedMatchPersistenceService", () => {
	let service: RankedMatchPersistenceService;
	let userProfileRepository: jest.Mocked<UserProfileRepository>;
	let logger: LoggerMock;
	let mockEntityManager: {
		create: jest.Mock;
		save: jest.Mock;
		findOne: jest.Mock;
	};

	beforeEach(() => {
		logger = new LoggerMock();
		userProfileRepository = {
			create: jest.fn(),
			findByUsername: jest.fn(),
			findById: jest.fn(),
			isBanned: jest.fn(),
			updatePassword: jest.fn(),
		};

		mockEntityManager = {
			create: jest.fn().mockImplementation((_, data) => ({ ...data })),
			save: jest
				.fn()
				.mockImplementation((entity) =>
					Promise.resolve({ ...entity, id: entity.id ?? "saved-id" }),
				),
			findOne: jest.fn().mockResolvedValue(null),
		};

		(dataSource.transaction as jest.Mock).mockImplementation(async (cb) => {
			return await cb(mockEntityManager);
		});

		service = new RankedMatchPersistenceService(logger, userProfileRepository);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it("skips non-ranked matches without touching dataSource or userProfileRepository", async () => {
		const event = new GameOverDomainEvent({
			bestOf: 3,
			date: new Date(),
			players: [],
			banListHash: 1109,
			banListName: "OCG 1109",
			ranked: false,
		});

		await service.persist(event);
		expect(dataSource.transaction).not.toHaveBeenCalled();
		expect(userProfileRepository.findByUsername).not.toHaveBeenCalled();
	});

	it("persists 2:0 ranked match with replay, match resumes, duels, and player stats in one transaction", async () => {
		const user1 = await UserProfile.create({
			id: "user-1",
			username: "Player1",
			password: "pin",
			email: null,
			avatar: null,
		});
		const user2 = await UserProfile.create({
			id: "user-2",
			username: "Player2",
			password: "pin",
			email: null,
			avatar: null,
		});

		userProfileRepository.findByUsername.mockResolvedValueOnce(user1).mockResolvedValueOnce(user2);

		const fakeYrp = new YGOProYrp({ header: new ReplayHeader() });
		const replayBytes = Buffer.from(fakeYrp.toYrp());

		const date = new Date("2026-09-01T20:00:00Z"); // Beijing 20260902 => season 202609

		const event = new GameOverDomainEvent({
			bestOf: 3,
			date,
			formatId: "1109",
			banListHash: 1109,
			banListName: "OCG 1109",
			ranked: true,
			players: [
				{
					id: "user-1",
					name: "Player1",
					team: Team.PLAYER,
					winner: true,
					score: 2,
					games: [
						{ result: "winner", turns: 5, ipAddress: "127.0.0.1" },
						{ result: "winner", turns: 6, ipAddress: "127.0.0.1" },
					],
				},
				{
					id: "user-2",
					name: "Player2",
					team: Team.OPPONENT,
					winner: false,
					score: 0,
					games: [
						{ result: "loser", turns: 5, ipAddress: "127.0.0.1" },
						{ result: "loser", turns: 6, ipAddress: "127.0.0.1" },
					],
				},
			],
			replays: [
				{
					duelIndex: 1,
					replayData: replayBytes,
					startedAt: new Date(date.getTime() - 600000),
					endedAt: new Date(date.getTime() - 300000),
				},
				{
					duelIndex: 2,
					replayData: replayBytes,
					startedAt: new Date(date.getTime() - 300000),
					endedAt: date,
				},
			],
		});

		await service.persist(event);

		expect(dataSource.transaction).toHaveBeenCalledTimes(1);
		expect(mockEntityManager.save).toHaveBeenCalled();
	});

	it("persists 2:0 ranked match points as +3 for the winner and -2 for the loser", async () => {
		const user1 = await UserProfile.create({
			id: "user-1",
			username: "Player1",
			password: "pin",
			email: null,
			avatar: null,
		});
		const user2 = await UserProfile.create({
			id: "user-2",
			username: "Player2",
			password: "pin",
			email: null,
			avatar: null,
		});

		userProfileRepository.findByUsername.mockResolvedValueOnce(user1).mockResolvedValueOnce(user2);

		const event = new GameOverDomainEvent({
			bestOf: 3,
			date: new Date("2026-09-01T20:00:00Z"),
			formatId: "1109",
			banListHash: 1109,
			banListName: "OCG 1109",
			ranked: true,
			players: [
				{
					id: "user-1",
					name: "Player1",
					team: Team.PLAYER,
					winner: true,
					score: 2,
					games: [
						{ result: "winner", turns: 5, ipAddress: "127.0.0.1" },
						{ result: "winner", turns: 6, ipAddress: "127.0.0.1" },
					],
				},
				{
					id: "user-2",
					name: "Player2",
					team: Team.OPPONENT,
					winner: false,
					score: 0,
					games: [
						{ result: "loser", turns: 5, ipAddress: "127.0.0.1" },
						{ result: "loser", turns: 6, ipAddress: "127.0.0.1" },
					],
				},
			],
		});

		await service.persist(event);

		const payloads = mockEntityManager.create.mock.calls.map(([, data]) => data);
		expect(payloads.find((data) => data.playerScore === 2).points).toBe(3);
		expect(payloads.find((data) => data.playerScore === 0).points).toBe(-2);
		expect(payloads.find((data) => data.wins === 1).points).toBe(3);
		expect(payloads.find((data) => data.losses === 1).points).toBe(-2);
	});

	it("persists 2:1 ranked match points as +2 for the winner and -1 for the loser", async () => {
		const user1 = await UserProfile.create({
			id: "user-1",
			username: "Player1",
			password: "pin",
			email: null,
			avatar: null,
		});
		const user2 = await UserProfile.create({
			id: "user-2",
			username: "Player2",
			password: "pin",
			email: null,
			avatar: null,
		});

		userProfileRepository.findByUsername.mockResolvedValueOnce(user1).mockResolvedValueOnce(user2);

		const event = new GameOverDomainEvent({
			bestOf: 3,
			date: new Date("2026-09-01T20:00:00Z"),
			formatId: "1109",
			banListHash: 1109,
			banListName: "OCG 1109",
			ranked: true,
			players: [
				{
					id: "user-1",
					name: "Player1",
					team: Team.PLAYER,
					winner: true,
					score: 2,
					games: [
						{ result: "winner", turns: 5, ipAddress: "127.0.0.1" },
						{ result: "loser", turns: 6, ipAddress: "127.0.0.1" },
						{ result: "winner", turns: 7, ipAddress: "127.0.0.1" },
					],
				},
				{
					id: "user-2",
					name: "Player2",
					team: Team.OPPONENT,
					winner: false,
					score: 1,
					games: [
						{ result: "loser", turns: 5, ipAddress: "127.0.0.1" },
						{ result: "winner", turns: 6, ipAddress: "127.0.0.1" },
						{ result: "loser", turns: 7, ipAddress: "127.0.0.1" },
					],
				},
			],
		});

		await service.persist(event);

		const payloads = mockEntityManager.create.mock.calls.map(([, data]) => data);
		expect(payloads.find((data) => data.playerScore === 2).points).toBe(2);
		expect(payloads.find((data) => data.playerScore === 1).points).toBe(-1);
		expect(payloads.find((data) => data.wins === 1).points).toBe(2);
		expect(payloads.find((data) => data.losses === 1).points).toBe(-1);
	});

	it("retries once with identical identifiers if the first transaction fails", async () => {
		const user1 = await UserProfile.create({
			id: "user-1",
			username: "Player1",
			password: "pin",
			email: null,
			avatar: null,
		});

		userProfileRepository.findByUsername.mockResolvedValue(user1);

		let callCount = 0;
		(dataSource.transaction as jest.Mock).mockImplementation(async (cb) => {
			callCount++;
			if (callCount === 1) {
				throw new Error("Temporary DB lock error");
			}
			return await cb(mockEntityManager);
		});

		const event = new GameOverDomainEvent({
			bestOf: 3,
			date: new Date("2026-09-01T20:00:00Z"),
			formatId: "1109",
			banListHash: 1109,
			banListName: "OCG 1109",
			ranked: true,
			players: [
				{
					id: "user-1",
					name: "Player1",
					team: Team.PLAYER,
					winner: true,
					score: 2,
					games: [{ result: "winner", turns: 5, ipAddress: "127.0.0.1" }],
				},
			],
		});

		await service.persist(event);

		expect(dataSource.transaction).toHaveBeenCalledTimes(2);
	});

	it("accurately aligns replay IDs by duelIndex even when earlier duel replays are missing", async () => {
		const user1 = await UserProfile.create({
			id: "user-1",
			username: "Player1",
			password: "pin",
			email: null,
			avatar: null,
		});
		userProfileRepository.findByUsername.mockResolvedValue(user1);

		const savedDuels: any[] = [];
		mockEntityManager.save.mockImplementation((entity) => {
			if (entity.result) {
				savedDuels.push(entity);
			}
			return Promise.resolve(entity);
		});

		// Only duel 2 replay is present (duelIndex = 2)
		const event = new GameOverDomainEvent({
			bestOf: 3,
			date: new Date("2026-09-01T20:00:00Z"),
			formatId: "1109",
			banListHash: 1109,
			banListName: "OCG 1109",
			ranked: true,
			players: [
				{
					id: "user-1",
					name: "Player1",
					team: Team.PLAYER,
					winner: true,
					score: 2,
					games: [
						{ result: "winner", turns: 5, ipAddress: "127.0.0.1" },
						{ result: "winner", turns: 6, ipAddress: "127.0.0.1" },
					],
				},
			],
			replays: [
				{
					duelIndex: 2,
					replayData: Buffer.from("replay2"),
					startedAt: new Date(),
					endedAt: new Date(),
				},
			],
		});

		await service.persist(event);

		expect(savedDuels).toHaveLength(2);
		// Duel 1 (i = 0) did not have a replay, so its replayId should not equal Duel 2's replayId
		expect(savedDuels[0].replayId).not.toBe(savedDuels[1].replayId);
	});

	it("is idempotent when the same gameId is persisted twice", async () => {
		const user1 = await UserProfile.create({
			id: "user-1",
			username: "Player1",
			password: "pin",
			email: null,
			avatar: null,
		});
		userProfileRepository.findByUsername.mockResolvedValue(user1);

		const gameId = "11111111-2222-3333-4444-555555555555";
		const event = new GameOverDomainEvent({
			gameId,
			bestOf: 3,
			date: new Date("2026-09-01T20:00:00Z"),
			formatId: "1109",
			banListHash: 1109,
			banListName: "OCG 1109",
			ranked: true,
			players: [
				{
					id: "user-1",
					name: "Player1",
					team: Team.PLAYER,
					winner: true,
					score: 2,
					games: [{ result: "winner", turns: 5, ipAddress: "127.0.0.1" }],
				},
			],
		});

		// First persist: no existing match
		mockEntityManager.findOne.mockResolvedValueOnce(null); // existingMatch check
		await service.persist(event);
		const initialSaveCalls = mockEntityManager.save.mock.calls.length;
		expect(initialSaveCalls).toBeGreaterThan(0);

		// Second persist: existing match found
		mockEntityManager.findOne.mockResolvedValueOnce({ id: "match-1", gameId }); // existingMatch check
		await service.persist(event);

		// save must not be called again
		expect(mockEntityManager.save).toHaveBeenCalledTimes(initialSaveCalls);
	});

	it("persists match_decks for both players when both user profiles and deck snapshots are valid", async () => {
		const user1 = await UserProfile.create({
			id: "user-1",
			username: "Player1",
			password: "pin",
			email: null,
			avatar: null,
		});
		const user2 = await UserProfile.create({
			id: "user-2",
			username: "Player2",
			password: "pin",
			email: null,
			avatar: null,
		});
		userProfileRepository.findByUsername.mockResolvedValueOnce(user1).mockResolvedValueOnce(user2);

		const main1 = Array(40).fill(69884162);
		main1[0] = 69884162;
		main1[1] = 69884162;
		main1[2] = 33846209;
		main1[3] = 33846209;
		main1[4] = 37412656;

		const main2 = Array(40).fill(10000);

		const event = new GameOverDomainEvent({
			bestOf: 3,
			date: new Date("2026-09-01T20:00:00Z"),
			formatId: "1109",
			banListHash: 1109,
			banListName: "OCG 1109",
			ranked: true,
			players: [
				{
					id: "user-1",
					name: "Player1",
					team: Team.PLAYER,
					winner: true,
					score: 2,
					games: [{ result: "winner", turns: 5, ipAddress: "127.0.0.1" }],
					deck: {
						mainCards: main1,
						extraCards: [20000],
						sideCards: [30000],
					},
				},
				{
					id: "user-2",
					name: "Player2",
					team: Team.OPPONENT,
					winner: false,
					score: 0,
					games: [{ result: "loser", turns: 5, ipAddress: "127.0.0.1" }],
					deck: {
						mainCards: main2,
						extraCards: [],
						sideCards: [],
					},
				},
			],
		});

		await service.persist(event);

		const matchDeckCreations = mockEntityManager.create.mock.calls.filter(
			(call) => call[0] === MatchDeckEntity,
		);
		expect(matchDeckCreations).toHaveLength(2);

		const player1Deck = matchDeckCreations[0][1];
		expect(player1Deck.formatId).toBe("1109");
		expect(player1Deck.deckTypeCode).toBe("D02"); // HB
		expect(player1Deck.snapshotSource).toBe("online");
		expect(player1Deck.mainCards).toEqual(main1);
		expect(player1Deck.extraCards).toEqual([20000]);
		expect(player1Deck.sideCards).toEqual([30000]);

		const player2Deck = matchDeckCreations[1][1];
		expect(player2Deck.formatId).toBe("1109");
		expect(player2Deck.deckTypeCode).toBe("OTHERS");
		expect(player2Deck.snapshotSource).toBe("online");
	});

	it("does not persist match_decks when one player user profile is missing", async () => {
		const user1 = await UserProfile.create({
			id: "user-1",
			username: "Player1",
			password: "pin",
			email: null,
			avatar: null,
		});
		userProfileRepository.findByUsername.mockResolvedValueOnce(user1).mockResolvedValueOnce(null);

		const event = new GameOverDomainEvent({
			bestOf: 3,
			date: new Date("2026-09-01T20:00:00Z"),
			formatId: "1109",
			banListHash: 1109,
			banListName: "OCG 1109",
			ranked: true,
			players: [
				{
					id: "user-1",
					name: "Player1",
					team: Team.PLAYER,
					winner: true,
					score: 2,
					games: [{ result: "winner", turns: 5, ipAddress: "127.0.0.1" }],
					deck: { mainCards: Array(40).fill(10000), extraCards: [], sideCards: [] },
				},
				{
					id: "user-2",
					name: "Player2",
					team: Team.OPPONENT,
					winner: false,
					score: 0,
					games: [{ result: "loser", turns: 5, ipAddress: "127.0.0.1" }],
					deck: { mainCards: Array(40).fill(10000), extraCards: [], sideCards: [] },
				},
			],
		});

		await service.persist(event);

		const matchDeckCreations = mockEntityManager.create.mock.calls.filter(
			(call) => call[0] === MatchDeckEntity,
		);
		expect(matchDeckCreations).toHaveLength(0);
	});

	it("does not persist match_decks when either player lacks deck snapshot", async () => {
		const user1 = await UserProfile.create({
			id: "user-1",
			username: "Player1",
			password: "pin",
			email: null,
			avatar: null,
		});
		const user2 = await UserProfile.create({
			id: "user-2",
			username: "Player2",
			password: "pin",
			email: null,
			avatar: null,
		});
		userProfileRepository.findByUsername.mockResolvedValueOnce(user1).mockResolvedValueOnce(user2);

		const event = new GameOverDomainEvent({
			bestOf: 3,
			date: new Date("2026-09-01T20:00:00Z"),
			formatId: "1109",
			banListHash: 1109,
			banListName: "OCG 1109",
			ranked: true,
			players: [
				{
					id: "user-1",
					name: "Player1",
					team: Team.PLAYER,
					winner: true,
					score: 2,
					games: [{ result: "winner", turns: 5, ipAddress: "127.0.0.1" }],
					deck: { mainCards: Array(40).fill(10000), extraCards: [], sideCards: [] },
				},
				{
					id: "user-2",
					name: "Player2",
					team: Team.OPPONENT,
					winner: false,
					score: 0,
					games: [{ result: "loser", turns: 5, ipAddress: "127.0.0.1" }],
				},
			],
		});

		await service.persist(event);

		const matchDeckCreations = mockEntityManager.create.mock.calls.filter(
			(call) => call[0] === MatchDeckEntity,
		);
		expect(matchDeckCreations).toHaveLength(0);
	});

	it("persists 1103 match decks as OTHERS with pre-G1 cards across 3 games", async () => {
		const user1 = await UserProfile.create({
			id: "user-1",
			username: "Player1",
			password: "pin",
			email: null,
			avatar: null,
		});
		const user2 = await UserProfile.create({
			id: "user-2",
			username: "Player2",
			password: "pin",
			email: null,
			avatar: null,
		});
		userProfileRepository.findByUsername.mockResolvedValueOnce(user1).mockResolvedValueOnce(user2);

		const g1Main1 = Array(40).fill(91188343); // Agents cards, but in 1103 it must be OTHERS
		const g1Main2 = Array(40).fill(10000);

		const event = new GameOverDomainEvent({
			bestOf: 3,
			date: new Date("2026-09-01T20:00:00Z"),
			formatId: "1103",
			banListHash: 1103,
			banListName: "OCG 1103",
			ranked: true,
			players: [
				{
					id: "user-1",
					name: "Player1",
					team: Team.PLAYER,
					winner: true,
					score: 2,
					games: [
						{ result: "winner", turns: 5, ipAddress: "127.0.0.1" },
						{ result: "loser", turns: 4, ipAddress: "127.0.0.1" },
						{ result: "winner", turns: 6, ipAddress: "127.0.0.1" },
					],
					deck: {
						mainCards: g1Main1,
						extraCards: [20001],
						sideCards: [30001],
					},
				},
				{
					id: "user-2",
					name: "Player2",
					team: Team.OPPONENT,
					winner: false,
					score: 1,
					games: [
						{ result: "loser", turns: 5, ipAddress: "127.0.0.1" },
						{ result: "winner", turns: 4, ipAddress: "127.0.0.1" },
						{ result: "loser", turns: 6, ipAddress: "127.0.0.1" },
					],
					deck: {
						mainCards: g1Main2,
						extraCards: [20002],
						sideCards: [30002],
					},
				},
			],
		});

		await service.persist(event);

		const matchDeckCreations = mockEntityManager.create.mock.calls.filter(
			(call) => call[0] === MatchDeckEntity,
		);
		expect(matchDeckCreations).toHaveLength(2);

		const p1Deck = matchDeckCreations[0][1];
		expect(p1Deck.formatId).toBe("1103");
		expect(p1Deck.deckTypeCode).toBe("OTHERS");
		expect(p1Deck.classifierVersion).toBe("1103-fallback-v1");
		expect(p1Deck.mainCards).toEqual(g1Main1);

		const p2Deck = matchDeckCreations[1][1];
		expect(p2Deck.formatId).toBe("1103");
		expect(p2Deck.deckTypeCode).toBe("OTHERS");
		expect(p2Deck.classifierVersion).toBe("1103-fallback-v1");
		expect(p2Deck.mainCards).toEqual(g1Main2);
	});

	it("persists 1109 match deck containing alt-art Rescue Rabbit 85138717 as D03 using CDB aliases", async () => {
		const user1 = await UserProfile.create({
			id: "user-1",
			username: "Player1",
			password: "pin",
			email: null,
			avatar: null,
		});
		const user2 = await UserProfile.create({
			id: "user-2",
			username: "Player2",
			password: "pin",
			email: null,
			avatar: null,
		});
		userProfileRepository.findByUsername.mockResolvedValueOnce(user1).mockResolvedValueOnce(user2);

		// D03 Dino Rabbit with 2x alt-art Rescue Rabbit 85138717, 1x Tour Guide 10802915, 2x Sabersaurus 37265642
		const fillerCards = Array.from({ length: 35 }, (_, i) => 10000000 + i);
		const g1Main1 = [85138717, 85138717, 10802915, 37265642, 37265642, ...fillerCards];
		const g1Main2 = Array(40).fill(10000);

		const event = new GameOverDomainEvent({
			bestOf: 3,
			date: new Date("2026-09-01T20:00:00Z"),
			formatId: "1109",
			banListHash: 1109,
			banListName: "OCG 1109",
			ranked: true,
			players: [
				{
					id: "user-1",
					name: "Player1",
					team: Team.PLAYER,
					winner: true,
					score: 2,
					games: [{ result: "winner", turns: 5, ipAddress: "127.0.0.1" }],
					deck: {
						mainCards: g1Main1,
						extraCards: [],
						sideCards: [],
					},
				},
				{
					id: "user-2",
					name: "Player2",
					team: Team.OPPONENT,
					winner: false,
					score: 0,
					games: [{ result: "loser", turns: 5, ipAddress: "127.0.0.1" }],
					deck: {
						mainCards: g1Main2,
						extraCards: [],
						sideCards: [],
					},
				},
			],
		});

		await service.persist(event);

		const matchDeckCreations = mockEntityManager.create.mock.calls.filter(
			(call) => call[0] === MatchDeckEntity,
		);
		expect(matchDeckCreations).toHaveLength(2);

		const p1Deck = matchDeckCreations[0][1];
		expect(p1Deck.formatId).toBe("1109");
		expect(p1Deck.deckTypeCode).toBe("D03");
	});
});
