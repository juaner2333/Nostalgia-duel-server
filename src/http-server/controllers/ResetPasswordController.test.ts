import { Request, Response } from "express";

import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";
import { ResetUserPassword } from "@shared/user-profile/application/ResetUserPassword";
import { ResetPasswordController } from "./ResetPasswordController";

describe("ResetPasswordController", () => {
	let resetUserPassword: jest.Mocked<ResetUserPassword>;
	let logger: LoggerMock;
	let controller: ResetPasswordController;
	let res: {
		status: jest.Mock;
		json: jest.Mock;
	};

	beforeEach(() => {
		resetUserPassword = {
			run: jest.fn(),
		} as unknown as jest.Mocked<ResetUserPassword>;
		logger = new LoggerMock();
		controller = new ResetPasswordController(resetUserPassword, logger);
		res = {
			status: jest.fn().mockReturnThis(),
			json: jest.fn().mockReturnThis(),
		};
	});

	it("returns 200 with new PIN for valid request when user exists", async () => {
		const req = {
			body: { username: "Duelist" },
		} as Request;

		resetUserPassword.run.mockResolvedValue({
			username: "Duelist",
			password: "0042",
		});

		await controller.run(req, res as unknown as Response);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			success: true,
			data: {
				username: "Duelist",
				password: "0042",
			},
		});
		expect(resetUserPassword.run).toHaveBeenCalledWith({ username: "Duelist" });
	});

	it("returns 400 when username is missing, empty, or not a string", async () => {
		const invalidPayloads = [{}, { username: "" }, { username: 123 }, { username: null }];

		for (const body of invalidPayloads) {
			jest.clearAllMocks();
			const req = { body } as Request;

			await controller.run(req, res as unknown as Response);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					success: false,
					errors: expect.any(Array),
				}),
			);
			expect(resetUserPassword.run).not.toHaveBeenCalled();
		}
	});

	it("returns 404 when user is not found, without leaking PIN", async () => {
		const req = {
			body: { username: "NonExistent" },
		} as Request;

		resetUserPassword.run.mockResolvedValue(null);

		await controller.run(req, res as unknown as Response);

		expect(res.status).toHaveBeenCalledWith(404);
		const jsonCall = res.json.mock.calls[0][0];
		expect(jsonCall).toEqual({
			success: false,
			error: "User not found",
		});
		expect(JSON.stringify(jsonCall)).not.toContain("password");
		expect(JSON.stringify(jsonCall)).not.toContain("0042");
	});

	it("logs error without password and returns 500 when persistence or use case throws", async () => {
		const req = {
			body: { username: "Duelist" },
		} as Request;

		const dbError = new Error("DB connection failure");
		resetUserPassword.run.mockRejectedValue(dbError);

		const errorSpy = jest.spyOn(logger, "error");
		await controller.run(req, res as unknown as Response);

		expect(res.status).toHaveBeenCalledWith(500);
		const jsonCall = res.json.mock.calls[0][0];
		expect(jsonCall).toEqual({
			success: false,
			error: "Internal server error",
		});
		expect(JSON.stringify(jsonCall)).not.toContain("password");

		// Logger was called and does not log passwords
		expect(errorSpy).toHaveBeenCalledTimes(1);
		const [loggedMsg, loggedContext] = errorSpy.mock.calls[0];
		expect(loggedContext).not.toHaveProperty("password");
		expect(loggedContext).not.toHaveProperty("pin");
		const loggedContent = JSON.stringify({ loggedMsg, loggedContext });
		expect(loggedContent).toContain("Duelist");
		expect(loggedContent).not.toContain("0042");
	});
});
