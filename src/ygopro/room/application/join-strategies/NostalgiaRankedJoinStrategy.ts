import { JoinContext, JoinStrategy } from "./JoinStrategy";
import {
	DirectNostalgiaRankedJoin,
	isRankedPass,
} from "../../ranked/application/DirectNostalgiaRankedJoin";
import { AuthenticateOrRegisterPinUser } from "@shared/user-auth/application/AuthenticateOrRegisterPinUser";
import { UserProfilePostgresRepository } from "@shared/user-profile/infrastructure/postgres/UserProfilePostgresRepository";
import { RankedRoomRegistry } from "../../ranked/domain/RankedRoomRegistry";
import { NostalgiaFormatResources } from "../../infrastructure/NostalgiaFormatResources";
import { config } from "src/config";

export class NostalgiaRankedJoinStrategy implements JoinStrategy {
	constructor(private readonly directRankedJoin?: DirectNostalgiaRankedJoin) {}

	matches(ctx: JoinContext): boolean {
		return isRankedPass(ctx.rawPass);
	}

	async handle(ctx: JoinContext): Promise<void> {
		if (!config.ranking.enabled) {
			throw new Error("Ranked rooms are currently disabled");
		}
		const runner =
			this.directRankedJoin ??
			new DirectNostalgiaRankedJoin(
				new AuthenticateOrRegisterPinUser(new UserProfilePostgresRepository()),
				RankedRoomRegistry.getInstance(),
				new NostalgiaFormatResources(),
			);

		await runner.run(ctx);
	}
}
