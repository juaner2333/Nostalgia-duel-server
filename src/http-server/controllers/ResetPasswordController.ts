import { Request, Response } from "express";
import { z } from "zod";

import { Logger } from "@shared/logger/domain/Logger";
import { ResetUserPassword } from "@shared/user-profile/application/ResetUserPassword";

export const ResetPasswordSchema = z.object({
	username: z.string().min(1),
});

export class ResetPasswordController {
	constructor(
		private readonly resetUserPassword: ResetUserPassword,
		private readonly logger: Logger,
	) {}

	public async run(req: Request, res: Response): Promise<void> {
		const validation = ResetPasswordSchema.safeParse(req.body);

		if (!validation.success) {
			res.status(400).json({
				success: false,
				errors: validation.error.issues,
			});
			return;
		}

		const { username } = validation.data;

		try {
			const result = await this.resetUserPassword.run({ username });
			if (!result) {
				res.status(404).json({
					success: false,
					error: "User not found",
				});
				return;
			}

			res.status(200).json({
				success: true,
				data: {
					username: result.username,
					password: result.password,
				},
			});
		} catch (error) {
			this.logger.error("Failed to reset credential for user", {
				username,
				error: error instanceof Error ? error.message : String(error),
			});

			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	}
}
