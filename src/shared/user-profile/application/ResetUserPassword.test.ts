import bcrypt from "bcrypt";

import { UserProfile } from "../domain/UserProfile";
import { UserProfileRepository } from "../domain/UserProfileRepository";
import { ResetUserPassword } from "./ResetUserPassword";

describe("ResetUserPassword", () => {
	let repository: jest.Mocked<UserProfileRepository>;

	beforeEach(() => {
		repository = {
			create: jest.fn(),
			findByUsername: jest.fn(),
			findById: jest.fn(),
			isBanned: jest.fn(),
			updatePassword: jest.fn(),
		};
	});

	it("generates and returns new PIN formatted as 4 digits when user exists, updates repository with bcrypt hash, invalidates old PIN and validates new PIN", async () => {
		const existingUser = await UserProfile.create({
			id: "user-123",
			username: "Duelist42",
			password: "old-pin",
			email: null,
			avatar: null,
		});
		repository.findByUsername.mockResolvedValue(existingUser);

		const randomIntMock = jest.fn().mockReturnValue(42);
		const useCase = new ResetUserPassword(repository, randomIntMock);

		const result = await useCase.run({ username: "Duelist42" });

		expect(result).toEqual({
			username: "Duelist42",
			password: "0042",
		});
		expect(randomIntMock).toHaveBeenCalledWith(0, 10000);
		expect(repository.findByUsername).toHaveBeenCalledWith("Duelist42");
		expect(repository.updatePassword).toHaveBeenCalledTimes(1);

		const [updatedUserId, updatedPasswordHash] = repository.updatePassword.mock.calls[0];
		expect(updatedUserId).toBe("user-123");
		expect(updatedPasswordHash).not.toBe("0042");
		expect(updatedPasswordHash).not.toBe(existingUser.password);

		// New PIN validates against the hash, old PIN invalidates
		expect(await bcrypt.compare("0042", updatedPasswordHash)).toBe(true);
		expect(await bcrypt.compare("old-pin", updatedPasswordHash)).toBe(false);
	});

	it("passes username exactly and does not generate PIN or update repository when user does not exist", async () => {
		repository.findByUsername.mockResolvedValue(null);

		const randomIntMock = jest.fn();
		const useCase = new ResetUserPassword(repository, randomIntMock);

		const result = await useCase.run({ username: "NonExistentUser" });

		expect(result).toBeNull();
		expect(repository.findByUsername).toHaveBeenCalledWith("NonExistentUser");
		expect(randomIntMock).not.toHaveBeenCalled();
		expect(repository.updatePassword).not.toHaveBeenCalled();
	});

	it("generates a valid 4-digit PIN using default random generator", async () => {
		const existingUser = await UserProfile.create({
			id: "user-default",
			username: "RealUser",
			password: "initial-pin",
			email: null,
			avatar: null,
		});
		repository.findByUsername.mockResolvedValue(existingUser);

		const useCase = new ResetUserPassword(repository);
		const result = await useCase.run({ username: "RealUser" });

		expect(result).not.toBeNull();
		expect(result?.username).toBe("RealUser");
		expect(result?.password).toMatch(/^\d{4}$/);
		expect(repository.updatePassword).toHaveBeenCalledTimes(1);
	});
});
