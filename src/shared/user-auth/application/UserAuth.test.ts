import { UserAuth } from "./UserAuth";
import { AuthFailureReason } from "../domain/AuthResult";
import { PlayerAuthInput } from "../domain/PlayerAuthInput";
import { UserProfile } from "../../user-profile/domain/UserProfile";
import { UserProfileRepository } from "../../user-profile/domain/UserProfileRepository";

const profileWithPassword = (acceptsPassword: boolean): UserProfile => {
	const profile = UserProfile.from({
		id: "u-1",
		username: "Player",
		password: "hash",
		email: "e@e",
		avatar: null,
	});
	jest.spyOn(profile, "isValidPassword").mockResolvedValue(acceptsPassword);

	return profile;
};

const input = (overrides?: Partial<PlayerAuthInput>): PlayerAuthInput => ({
	name: "Player",
	password: "1234",
	...overrides,
});

describe("UserAuth", () => {
	let repository: jest.Mocked<UserProfileRepository>;
	let userAuth: UserAuth;

	beforeEach(() => {
		repository = {
			create: jest.fn(),
			findByUsername: jest.fn(),
			findById: jest.fn(),
			isBanned: jest.fn(),
		};
		userAuth = new UserAuth(repository);
	});

	it("returns the profile when the password matches", async () => {
		const profile = profileWithPassword(true);
		repository.findByUsername.mockResolvedValue(profile);

		const result = await userAuth.run(input());

		expect(result).toEqual({ ok: true, profile });
	});

	it("fails with user-not-found when no profile matches the name", async () => {
		repository.findByUsername.mockResolvedValue(null);

		const result = await userAuth.run(input());

		expect(result).toEqual({ ok: false, reason: AuthFailureReason.USER_NOT_FOUND });
		expect(repository.isBanned).not.toHaveBeenCalled();
	});

	it("fails with user-banned when the profile is banned", async () => {
		repository.findByUsername.mockResolvedValue(profileWithPassword(true));
		repository.isBanned.mockResolvedValue(true);

		const result = await userAuth.run(input());

		expect(result).toEqual({ ok: false, reason: AuthFailureReason.USER_BANNED });
	});

	it("fails with invalid-password when the input carries no password", async () => {
		repository.findByUsername.mockResolvedValue(profileWithPassword(true));

		const result = await userAuth.run(input({ password: null }));

		expect(result).toEqual({ ok: false, reason: AuthFailureReason.INVALID_PASSWORD });
	});

	it("fails with invalid-password when the password does not match", async () => {
		repository.findByUsername.mockResolvedValue(profileWithPassword(false));

		const result = await userAuth.run(input({ password: "9999" }));

		expect(result).toEqual({ ok: false, reason: AuthFailureReason.INVALID_PASSWORD });
	});
});
