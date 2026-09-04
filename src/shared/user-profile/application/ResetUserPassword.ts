import { randomInt } from "crypto";

import { UserProfileRepository } from "../domain/UserProfileRepository";

export type ResetUserPasswordInput = {
	readonly username: string;
};

export type ResetUserPasswordResult = {
	readonly username: string;
	readonly password: string;
};

export class ResetUserPassword {
	constructor(
		private readonly userProfileRepository: UserProfileRepository,
		private readonly randomIntFn: (min: number, max: number) => number = randomInt,
	) {}

	async run(input: ResetUserPasswordInput): Promise<ResetUserPasswordResult | null> {
		const user = await this.userProfileRepository.findByUsername(input.username);
		if (!user) {
			return null;
		}

		const pinNumber = this.randomIntFn(0, 10000);
		const newPin = pinNumber.toString().padStart(4, "0");

		const updatedUser = await user.rehashPassword(newPin);
		await this.userProfileRepository.updatePassword(user.id, updatedUser.password);

		return {
			username: user.username,
			password: newPin,
		};
	}
}
