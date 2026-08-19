import { UserProfile } from "../../user-profile/domain/UserProfile";

export enum AuthFailureReason {
	USER_NOT_FOUND = "user-not-found",
	USER_BANNED = "user-banned",
	INVALID_PASSWORD = "invalid-password",
}

export type AuthResult =
	| { readonly ok: true; readonly profile: UserProfile }
	| { readonly ok: false; readonly reason: AuthFailureReason };
