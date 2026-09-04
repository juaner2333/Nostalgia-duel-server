import { UserProfile } from "./UserProfile";

describe("UserProfile", () => {
	it("rehashes password, making the new PIN valid and old PIN invalid", async () => {
		const user = await UserProfile.create({
			id: "user-1",
			username: "Alice",
			password: "old-pin",
			email: "alice@example.com",
			avatar: "avatar.png",
		});

		expect(await user.isValidPassword("old-pin")).toBe(true);

		const updatedUser = await user.rehashPassword("0042");

		expect(updatedUser.id).toBe(user.id);
		expect(updatedUser.username).toBe("Alice");
		expect(updatedUser.email).toBe("alice@example.com");
		expect(updatedUser.avatar).toBe("avatar.png");
		expect(updatedUser.password).not.toBe(user.password);

		expect(await updatedUser.isValidPassword("0042")).toBe(true);
		expect(await updatedUser.isValidPassword("old-pin")).toBe(false);
	});
});
