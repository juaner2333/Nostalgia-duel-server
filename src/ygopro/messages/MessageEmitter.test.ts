import { EventEmitter } from "stream";

import {
	EXPECTED_JOIN_GAME,
	EXPECTED_PLAYER_INFO,
	JOIN_GAME_PAYLOAD_HEX,
	PLAYER_INFO_PAYLOAD_HEX,
	YGOPRO_FIRST_PACKET,
} from "@test-support/fixtures/ygopro-first-packet";
import { LoggerMock } from "@test-support/mocks/logger/LoggerMock";

import { Commands } from "@shared/messages/Commands";
import { ClientMessage } from "@shared/messages/MessageProcessor";
import { MessageEmitter } from "./MessageEmitter";

describe("MessageEmitter · fixed YGOPro first packet", () => {
	const createEmitter = (eventEmitter: EventEmitter) => {
		const createGameListener = jest.fn();
		const joinGameListener = jest.fn();
		const emitter = new MessageEmitter(
			new LoggerMock(),
			eventEmitter,
			createGameListener,
			joinGameListener,
		);
		return { emitter, createGameListener, joinGameListener };
	};

	it("dispatches PlayerInfo and JoinGame exactly once and in wire order", () => {
		const eventEmitter = new EventEmitter();
		const dispatches: Array<{ command: number; data: Buffer }> = [];
		eventEmitter.on(Commands.PLAYER_INFO as unknown as string, (message: ClientMessage) =>
			dispatches.push({ command: message.command, data: message.data }),
		);
		eventEmitter.on(Commands.JOIN_GAME as unknown as string, (message: ClientMessage) =>
			dispatches.push({ command: message.command, data: message.data }),
		);

		const { emitter, createGameListener, joinGameListener } = createEmitter(eventEmitter);
		emitter.handleMessage(YGOPRO_FIRST_PACKET);

		expect(dispatches).toEqual([
			{ command: EXPECTED_PLAYER_INFO.command, data: Buffer.from(PLAYER_INFO_PAYLOAD_HEX, "hex") },
			{ command: EXPECTED_JOIN_GAME.command, data: Buffer.from(JOIN_GAME_PAYLOAD_HEX, "hex") },
		]);
		expect(joinGameListener).toHaveBeenCalledTimes(1);
		expect(createGameListener).not.toHaveBeenCalled();
	});

	it("consumes the ExternalAddress frame without dispatching it", () => {
		const eventEmitter = new EventEmitter();
		const externalAddressListener = jest.fn();
		eventEmitter.on("23", externalAddressListener);

		const { emitter } = createEmitter(eventEmitter);
		emitter.handleMessage(YGOPRO_FIRST_PACKET);

		expect(externalAddressListener).not.toHaveBeenCalled();
	});

	it("exposes the PlayerInfo payload as the JoinGame previous message", () => {
		const eventEmitter = new EventEmitter();
		const joinMessages: ClientMessage[] = [];
		eventEmitter.on(Commands.JOIN_GAME as unknown as string, (message: ClientMessage) =>
			joinMessages.push(message),
		);

		const { emitter } = createEmitter(eventEmitter);
		emitter.handleMessage(YGOPRO_FIRST_PACKET);

		// The leading ExternalAddress frame must not overwrite the PlayerInfo
		// payload the join flow reads from previousMessage.
		expect(joinMessages).toHaveLength(1);
		expect(joinMessages[0].previousMessage).toEqual(Buffer.from(PLAYER_INFO_PAYLOAD_HEX, "hex"));
	});
});
