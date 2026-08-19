// Tests for the re-callable loader functions extracted from bootstrap.
// The functions are pure builders: they parse into a local temp array and do NOT touch
// the live YGOProBanListMemoryRepository. Mocking at the class level to avoid fs deps.
// Prevent config from loading env that doesn't exist in test env
jest.mock("src/config", () => ({
	config: {
		resources: { dir: "/fake/resources" },
	},
}));

import { YGOProBanList } from "@ygopro/ban-list/domain/YGOProBanList";

jest.mock("@ygopro/ban-list/infrastructure/YGOProBanListLoader", () => ({
	YGOProBanListLoader: jest.fn(),
}));

import { YGOProBanListLoader } from "@ygopro/ban-list/infrastructure/YGOProBanListLoader";

// Import the functions AFTER mocks are set up
import { loadYgoproBanLists } from "./bootstrapBanListLoaders";

// Cast to jest.Mock so we can control the constructor's returned instance via mockImplementation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockYGOProBanListLoader = YGOProBanListLoader as jest.Mock<any>;

function makeYgoList(name: string): YGOProBanList {
	const list = new YGOProBanList();
	list.setName(name);
	return list;
}

describe("loadYgoproBanLists", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("calls load() once on YGOProBanListLoader", async () => {
		const mockLoad = jest.fn().mockResolvedValue(undefined);
		MockYGOProBanListLoader.mockImplementation(() => ({
			load: mockLoad,
			getLoaded: () => [],
		}));

		await loadYgoproBanLists();

		expect(mockLoad).toHaveBeenCalledTimes(1);
	});

	it("resolves without throwing when loader succeeds", async () => {
		MockYGOProBanListLoader.mockImplementation(() => ({
			load: jest.fn().mockResolvedValue(undefined),
			getLoaded: () => [],
		}));

		await expect(loadYgoproBanLists()).resolves.not.toThrow();
	});

	it("propagates the error when load throws — caller is responsible for error handling", async () => {
		MockYGOProBanListLoader.mockImplementation(() => ({
			load: jest.fn().mockRejectedValue(new Error("parse error")),
			getLoaded: () => [],
		}));

		await expect(loadYgoproBanLists()).rejects.toThrow("parse error");
	});

	it("returns loaded YGOProBanList array from the loader", async () => {
		const listX = makeYgoList("TCG 2026.04");
		const mockLoad = jest.fn().mockResolvedValue(undefined);
		MockYGOProBanListLoader.mockImplementation(() => ({
			load: mockLoad,
			getLoaded: () => [listX],
		}));

		const result = await loadYgoproBanLists();

		expect(result).toHaveLength(1);
		expect(result[0]).toBe(listX);
	});
});
