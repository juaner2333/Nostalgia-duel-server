import { randomUUID } from "crypto";

import { AuthFailureReason, AuthResult } from "../domain/AuthResult";
import { UserProfile } from "../../user-profile/domain/UserProfile";
import { UserProfileRepository } from "../../user-profile/domain/UserProfileRepository";

export type PinAuthInput = {
	readonly name: string;
	readonly pin: string;
};

export class AuthenticateOrRegisterPinUser {
	constructor(private readonly userProfileRepository: UserProfileRepository) {}

	async run(input: PinAuthInput): Promise<AuthResult> {
		const existingUser = await this.userProfileRepository.findByUsername(input.name);

		if (existingUser) {
			const isBanned = await this.userProfileRepository.isBanned(existingUser.id);
			if (isBanned) {
				return { ok: false, reason: AuthFailureReason.USER_BANNED };
			}

			const isValid = await existingUser.isValidPassword(input.pin);
			if (!isValid) {
				return { ok: false, reason: AuthFailureReason.INVALID_PASSWORD };
			}

			return { ok: true, profile: existingUser };
		}

		const newUser = await UserProfile.create({
			id: randomUUID(),
			username: input.name,
			password: input.pin,
			email: null,
			avatar: null,
		});

		try {
			await this.userProfileRepository.create(newUser);
			return { ok: true, profile: newUser };
		} catch {
			// Handle race condition where user was concurrently registered
			const racedUser = await this.userProfileRepository.findByUsername(input.name);
			if (racedUser) {
				const isBanned = await this.userProfileRepository.isBanned(racedUser.id);
				if (isBanned) {
					return { ok: false, reason: AuthFailureReason.USER_BANNED };
				}

				const isValid = await racedUser.isValidPassword(input.pin);
				if (!isValid) {
					return { ok: false, reason: AuthFailureReason.INVALID_PASSWORD };
				}

				return { ok: true, profile: racedUser };
			}

			return { ok: false, reason: AuthFailureReason.USER_NOT_FOUND };
		}
	}
}
