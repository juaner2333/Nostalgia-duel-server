import { AuthenticateOrRegisterPinUser } from "./AuthenticateOrRegisterPinUser";
import { AuthFailureReason } from "../domain/AuthResult";
import { UserProfile } from "../../user-profile/domain/UserProfile";
import { UserProfileRepository } from "../../user-profile/domain/UserProfileRepository";

describe("AuthenticateOrRegisterPinUser", () => {
	let userProfileRepository: jest.Mocked<UserProfileRepository>;
	let useCase: AuthenticateOrRegisterPinUser;

	beforeEach(() => {
		userProfileRepository = {
			create: jest.fn(),
			findByUsername: jest.fn(),
			findById: jest.fn(),
			isBanned: jest.fn(),
			updatePassword: jest.fn(),
		};
		useCase = new AuthenticateOrRegisterPinUser(userProfileRepository);
	});

	it("authenticates an existing active user when PIN matches", async () => {
		const existing = await UserProfile.create({
			id: "user-1",
			username: "Duelist",
			password: "1234",
			email: null,
			avatar: null,
		});
		userProfileRepository.findByUsername.mockResolvedValue(existing);
		userProfileRepository.isBanned.mockResolvedValue(false);

		const result = await useCase.run({ name: "Duelist", pin: "1234" });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.profile.id).toBe("user-1");
			expect(result.profile.username).toBe("Duelist");
		}
		expect(userProfileRepository.create).not.toHaveBeenCalled();
	});

	it("fails authentication when existing user enters wrong PIN", async () => {
		const existing = await UserProfile.create({
			id: "user-1",
			username: "Duelist",
			password: "1234",
			email: null,
			avatar: null,
		});
		userProfileRepository.findByUsername.mockResolvedValue(existing);
		userProfileRepository.isBanned.mockResolvedValue(false);

		const result = await useCase.run({ name: "Duelist", pin: "9999" });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe(AuthFailureReason.INVALID_PASSWORD);
		}
		expect(userProfileRepository.create).not.toHaveBeenCalled();
	});

	it("fails authentication when user is banned even with correct PIN", async () => {
		const existing = await UserProfile.create({
			id: "user-1",
			username: "Duelist",
			password: "1234",
			email: null,
			avatar: null,
		});
		userProfileRepository.findByUsername.mockResolvedValue(existing);
		userProfileRepository.isBanned.mockResolvedValue(true);

		const result = await useCase.run({ name: "Duelist", pin: "1234" });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe(AuthFailureReason.USER_BANNED);
		}
		expect(userProfileRepository.create).not.toHaveBeenCalled();
	});

	it("automatically registers a new user with empty email when user does not exist", async () => {
		userProfileRepository.findByUsername.mockResolvedValue(null);
		userProfileRepository.create.mockResolvedValue(undefined);

		const result = await useCase.run({ name: "Newbie", pin: "4321" });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.profile.username).toBe("Newbie");
			expect(result.profile.email).toBeNull();
			expect(await result.profile.isValidPassword("4321")).toBe(true);
		}
		expect(userProfileRepository.create).toHaveBeenCalledTimes(1);
	});

	it("re-authenticates after username unique constraint race condition during registration", async () => {
		const racedUser = await UserProfile.create({
			id: "raced-id",
			username: "RacedUser",
			password: "5678",
			email: null,
			avatar: null,
		});

		userProfileRepository.findByUsername.mockResolvedValueOnce(null);
		userProfileRepository.create.mockRejectedValueOnce(
			new Error("duplicate key value violates unique constraint"),
		);
		userProfileRepository.findByUsername.mockResolvedValueOnce(racedUser);
		userProfileRepository.isBanned.mockResolvedValue(false);

		const result = await useCase.run({ name: "RacedUser", pin: "5678" });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.profile.id).toBe("raced-id");
		}
	});

	it("fails with invalid password if raced registration provided wrong PIN", async () => {
		const racedUser = await UserProfile.create({
			id: "raced-id",
			username: "RacedUser",
			password: "5678",
			email: null,
			avatar: null,
		});

		userProfileRepository.findByUsername.mockResolvedValueOnce(null);
		userProfileRepository.create.mockRejectedValueOnce(
			new Error("duplicate key value violates unique constraint"),
		);
		userProfileRepository.findByUsername.mockResolvedValueOnce(racedUser);
		userProfileRepository.isBanned.mockResolvedValue(false);

		const result = await useCase.run({ name: "RacedUser", pin: "0000" });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe(AuthFailureReason.INVALID_PASSWORD);
		}
	});

	describe("PIN privacy and rejection guarantees", () => {
		it("ensures auth failure result does not leak the submitted PIN", async () => {
			const existing = await UserProfile.create({
				id: "user-1",
				username: "Duelist",
				password: "1234",
				email: null,
				avatar: null,
			});
			userProfileRepository.findByUsername.mockResolvedValue(existing);
			userProfileRepository.isBanned.mockResolvedValue(false);

			const secretPin = "9876";
			const result = await useCase.run({ name: "Duelist", pin: secretPin });

			expect(result.ok).toBe(false);
			const serialized = JSON.stringify(result);
			expect(serialized).not.toContain(secretPin);
		});

		it("ensures successful auth profile does not leak plaintext PIN", async () => {
			userProfileRepository.findByUsername.mockResolvedValue(null);
			userProfileRepository.create.mockResolvedValue(undefined);

			const secretPin = "4321";
			const result = await useCase.run({ name: "Newbie", pin: secretPin });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.profile.password).not.toBe(secretPin);
				const serialized = JSON.stringify(result.profile);
				expect(serialized).not.toContain(secretPin);
			}
		});
	});
});
