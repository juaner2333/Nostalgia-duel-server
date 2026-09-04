import { RankedMatchPersistenceService } from "./RankedMatchPersistenceService";
import { GameOverDomainEvent } from "@shared/room/domain/match/domain/domain-events/GameOverDomainEvent";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { UserProfileRepository } from "@shared/user-profile/domain/UserProfileRepository";
import { UserProfile } from "@shared/user-profile/domain/UserProfile";
import { Team } from "@shared/room/Team";
import { dataSource } from "../../../evolution-types/src/data-source";
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
});
