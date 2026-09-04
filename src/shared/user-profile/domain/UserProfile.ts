import bcrypt from "bcrypt";

export type UserProfileProperties = {
	id: string;
	username: string;
	password: string;
	email: string | null;
	avatar: string | null;
};
export class UserProfile {
	readonly id: string;
	readonly username: string;
	readonly password: string;
	readonly email: string | null;
	readonly avatar: string | null;

	private constructor({ id, username, password, email, avatar }: UserProfileProperties) {
		this.id = id;
		this.username = username;
		this.password = password;
		this.email = email;
		this.avatar = avatar;
	}

	static async create({
		id,
		username,
		password,
		email = null,
		avatar,
	}: {
		id: string;
		username: string;
		password: string;
		email?: string | null;
		avatar: string | null;
	}): Promise<UserProfile> {
		const passwordHashed = await bcrypt.hash(password, 10);

		return new UserProfile({
			id,
			username,
			password: passwordHashed,
			email,
			avatar,
		});
	}

	static from(data: {
		id: string;
		username: string;
		password: string;
		email: string | null;
		avatar: string | null;
	}): UserProfile {
		return new UserProfile(data);
	}

	async isValidPassword(password: string): Promise<boolean> {
		return bcrypt.compare(password, this.password);
	}

	async rehashPassword(newPassword: string): Promise<UserProfile> {
		const passwordHashed = await bcrypt.hash(newPassword, 10);

		return new UserProfile({
			id: this.id,
			username: this.username,
			password: passwordHashed,
			email: this.email,
			avatar: this.avatar,
		});
	}
}
