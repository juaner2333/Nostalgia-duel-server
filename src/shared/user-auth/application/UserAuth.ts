import { AuthFailureReason, AuthResult } from "../domain/AuthResult";
import { PlayerAuthInput } from "../domain/PlayerAuthInput";

import { UserProfileRepository } from "../../user-profile/domain/UserProfileRepository";

export class UserAuth {
	constructor(private readonly userProfileRepository: UserProfileRepository) {}

	async run(playerInfo: PlayerAuthInput): Promise<AuthResult> {
		const userProfile = await this.userProfileRepository.findByUsername(playerInfo.name);

		if (!userProfile) {
			return { ok: false, reason: AuthFailureReason.USER_NOT_FOUND };
		}

		const isBanned = await this.userProfileRepository.isBanned(userProfile.id);
		if (isBanned) {
			return { ok: false, reason: AuthFailureReason.USER_BANNED };
		}

		if (!playerInfo.password || !(await userProfile.isValidPassword(playerInfo.password))) {
			return { ok: false, reason: AuthFailureReason.INVALID_PASSWORD };
		}

		return { ok: true, profile: userProfile };
	}
}
