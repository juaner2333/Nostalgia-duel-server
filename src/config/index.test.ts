describe("nostalgia profile configuration", () => {
	it.each([
		[undefined, "goat"],
		["goat", "goat"],
		["2011", "2011"],
	])("selects the %s profile as %s", (configuredProfile, expectedProfile) => {
		const originalEnv = process.env;
		try {
			process.env = { ...originalEnv };
			if (configuredProfile === undefined) {
				delete process.env.NOSTALGIA_PROFILE;
			} else {
				process.env.NOSTALGIA_PROFILE = configuredProfile;
			}

			jest.isolateModules(() => {
				const { config } = jest.requireActual<typeof import("./index")>("./index");
				expect(config.resources.profile).toBe(expectedProfile);
			});
		} finally {
			process.env = originalEnv;
		}
	});
});
