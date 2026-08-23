/**
 * OCGCore dispose lifecycle (isDisposing state machine).
 *
 * Closing a duel disposes the worker while an in-flight advance() may still be
 * suspended on a yielded result; when the loop resumes, the worker channel is
 * already closed and the generator rejects. That rejection must be treated as
 * a normal lifecycle end (no error log, no extra draw broadcast), while a real
 * engine crash outside of disposing keeps the existing draw-protection.
 *
 * Tests drive OCGCore directly with an injected fake worker, without spinning
 * up a real ocgcore worker thread.
 */

import { YGOProMsgWin, YGOProStocChat } from "ygopro-msg-encode";

import { Logger } from "@shared/logger/domain/Logger";
import { Team } from "@shared/room/Team";
import { DuelRecordMother } from "@test-support/mothers/room/DuelRecordMother";
import { YGOProRoomMother } from "@test-support/mothers/room/YGOProRoomMother";
import { YGOProClient } from "../client/domain/YGOProClient";
import { YGOProRoom } from "../room/domain/YGOProRoom";
import { OCGCore } from "./ocgcore";

const DRAW_TEXT = "The duel has ended in a draw due to a server error.";
const CHANNEL_CLOSED_ERROR = new Error("Worker thread terminated: channel closed");

const makeLogger = () => ({
	child: jest.fn().mockReturnThis(),
	debug: jest.fn(),
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
});

const makeSocket = () => ({
	id: "sock-1",
	send: jest.fn(),
	destroy: jest.fn(),
	onMessage: jest.fn(),
	remoteAddress: "127.0.0.1",
});

const makeClient = (room: YGOProRoom, name: string): { client: YGOProClient; sent: jest.Mock } => {
	const socket = makeSocket();
	const client = new YGOProClient({
		name,
		socket: socket as never,
		logger: makeLogger() as unknown as Logger,
		position: 0,
		room,
		host: false,
		id: name,
		team: Team.PLAYER,
	});
	room.addPlayerUnsafe(client);
	socket.send.mockClear();
	return { client, sent: socket.send };
};

const makeRoom = (): YGOProRoom => {
	const room = YGOProRoomMother.create();
	room.addDuelRecord(DuelRecordMother.create());
	return room;
};

interface FakeOcgcore {
	advance: () => AsyncGenerator<{ status: number; message?: unknown }>;
	dispose: jest.Mock;
	finalize: jest.Mock;
}

const makeFakeOcgcore = (overrides: Partial<FakeOcgcore> = {}): FakeOcgcore => ({
	advance: async function* () {
		yield { status: 0, message: undefined };
	},
	dispose: jest.fn().mockResolvedValue(undefined),
	finalize: jest.fn().mockResolvedValue(undefined),
	...overrides,
});

const injectFakeOcgcore = (core: OCGCore, fake: FakeOcgcore): void => {
	(core as unknown as { ocgcore: FakeOcgcore }).ocgcore = fake;
};

/** YGOPro frames carry a 3-byte header (2-byte length + 1-byte type) before the payload. */
const sentChatTexts = (sent: jest.Mock): string[] =>
	(sent.mock.calls as [Buffer][]).flatMap(([frame]) => {
		try {
			const chat = new YGOProStocChat().fromPayload(frame.subarray(3));
			return chat.msg ? [chat.msg] : [];
		} catch {
			return [];
		}
	});

describe("OCGCore dispose lifecycle", () => {
	it("broadcasts a draw and logs the error when advance() rejects without dispose", async () => {
		const room = makeRoom();
		const first = makeClient(room, "P1");
		const second = makeClient(room, "P2");
		const logger = makeLogger();
		const core = new OCGCore(room, logger as unknown as Logger);
		injectFakeOcgcore(
			core,
			makeFakeOcgcore({
				advance: async function* () {
					yield { status: 0, message: undefined };
					throw CHANNEL_CLOSED_ERROR;
				},
			}),
		);

		await core.advance();

		// Real-engine crash protection must stay intact outside of disposing.
		expect(logger.error).toHaveBeenCalledWith(
			"Error while advancing ocgcore",
			expect.objectContaining({ error: CHANNEL_CLOSED_ERROR, isTimeout: false }),
		);
		for (const { sent } of [first, second]) {
			expect(sentChatTexts(sent)).toContain(DRAW_TEXT);
		}
	});

	it("does not log errors or broadcast a draw when advance() rejects during dispose", async () => {
		const room = makeRoom();
		const { sent } = makeClient(room, "P1");
		const logger = makeLogger();
		const core = new OCGCore(room, logger as unknown as Logger);
		injectFakeOcgcore(
			core,
			makeFakeOcgcore({
				advance: async function* () {
					yield { status: 0, message: undefined };
					throw CHANNEL_CLOSED_ERROR;
				},
			}),
		);

		// dispose marks isDisposing before the suspended advance() resumes and
		// hits the closed worker channel.
		const advancing = core.advance();
		await core.dispose();
		await advancing;

		expect(logger.error).not.toHaveBeenCalledWith(
			"Error while advancing ocgcore",
			expect.anything(),
		);
		expect(sent).not.toHaveBeenCalled();
	});

	it("returns silently on double dispose without a second worker dispose", async () => {
		const room = makeRoom();
		const logger = makeLogger();
		const core = new OCGCore(room, logger as unknown as Logger);
		const dispose = jest
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValue(new Error("Worker has been finalized"));
		injectFakeOcgcore(core, makeFakeOcgcore({ dispose }));

		await core.dispose();
		await core.dispose();

		expect(dispose).toHaveBeenCalledTimes(1);
		expect(logger.error).not.toHaveBeenCalledWith("Error disposing ocgcore", expect.anything());
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("settles a win without dispose errors when side-decking disposes again", async () => {
		const room = makeRoom();
		const { sent } = makeClient(room, "P1");
		const logger = makeLogger();
		const core = new OCGCore(room, logger as unknown as Logger);
		const winMessage = new YGOProMsgWin().fromPartial({ type: 0x1, player: 0 });
		const dispose = jest
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValue(new Error("Worker has been finalized"));
		injectFakeOcgcore(
			core,
			makeFakeOcgcore({
				advance: async function* () {
					yield { status: 1, message: winMessage };
				},
				dispose,
			}),
		);

		// The Win branch disposes first; the best-of-3 side-decking path then
		// calls disposeCore() again — must be a silent no-op (no second worker
		// dispose, no "Worker has been finalized" noise, no dispose timeout warn).
		await core.advance();
		await core.dispose();

		expect(dispose).toHaveBeenCalledTimes(1);
		expect(logger.error).not.toHaveBeenCalledWith("Error disposing ocgcore", expect.anything());
		expect(logger.warn).not.toHaveBeenCalled();
		expect(sent).not.toHaveBeenCalled();
	});

	it("does not dispose twice when a win message arrives after an external dispose", async () => {
		const room = makeRoom();
		const logger = makeLogger();
		const core = new OCGCore(room, logger as unknown as Logger);
		const winMessage = new YGOProMsgWin().fromPartial({ type: 0x1, player: 0 });
		const dispose = jest
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValue(new Error("Worker has been finalized"));
		injectFakeOcgcore(
			core,
			makeFakeOcgcore({
				advance: async function* () {
					yield { status: 1, message: winMessage };
				},
				dispose,
			}),
		);

		// External dispose (e.g. surrender) precedes the win result arriving on
		// the advance loop; the advance loop must stop without a second dispose
		// and without advancing-error noise.
		const advancing = core.advance();
		await core.dispose();
		await advancing;

		expect(dispose).toHaveBeenCalledTimes(1);
		expect(logger.error).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
	});
});
