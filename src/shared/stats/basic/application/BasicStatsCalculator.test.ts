import { mock, MockProxy } from "jest-mock-extended";
import { Logger } from "@shared/logger/domain/Logger";
import { UserProfileRepository } from "@shared/user-profile/domain/UserProfileRepository";
import { GameOverDomainEventMother } from "@test-support/mothers/player/GameOverDomainEventMother";
import { BasicStatsCalculator } from "./BasicStatsCalculator";
import { RankedMatchPersistenceService } from "../../persistence/RankedMatchPersistenceService";

describe("BasicStatsCalculator", () => {
	let basicStatsCalculator: BasicStatsCalculator;
	let logger: MockProxy<Logger>;
	let userProfileRepository: MockProxy<UserProfileRepository>;
	let persistenceService: MockProxy<RankedMatchPersistenceService>;

	beforeEach(() => {
		logger = mock<Logger>();
		logger.child.mockReturnValue(logger);
		userProfileRepository = mock();
		persistenceService = mock();

		basicStatsCalculator = new BasicStatsCalculator(
			logger,
			userProfileRepository,
			persistenceService,
		);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it("delegates event handling to RankedMatchPersistenceService", async () => {
		const event = GameOverDomainEventMother.create({
			ranked: true,
			formatId: "1109",
			banListName: "1109",
		});

		await basicStatsCalculator.handle(event);

		expect(persistenceService.persist).toHaveBeenCalledWith(event);
	});
});
