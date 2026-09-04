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

import EventEmitter from "events";
import { YGOProMsgWin, YGOProStocChat } from "ygopro-msg-encode";

import { Logger } from "@shared/logger/domain/Logger";
import { Team } from "@shared/room/Team";
import { DuelRecordMother } from "@test-support/mothers/room/DuelRecordMother";
import { YGOProRoomMother } from "@test-support/mothers/room/YGOProRoomMother";
import { YGOProClient } from "../client/domain/YGOProClient";
import { YGOProRoom } from "../room/domain/YGOProRoom";
import { OCGCore } from "./ocgcore";

const DRAW_TEXT = "服务器发生错误，本局以平局结束。";
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
	// Custom fixture: keep the legacy 450s limit so timer mechanics stay
	// decoupled from the room factory default (300s).
	(room as unknown as { _hostInfo: { time_limit: number } })._hostInfo.time_limit = 450;
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

	it("does not reschedule response timer or trigger timeout when reschedule races with dispose", async () => {
		jest.useFakeTimers();
		try {
			const room = makeRoom();
			makeClient(room, "P1");
			makeClient(room, "P2");
			const logger = makeLogger();
			const core = new OCGCore(room, logger as unknown as Logger);
			const fakeWorker = makeFakeOcgcore();
			injectFakeOcgcore(core, fakeWorker);

			core.resetResponseRequestState();

			// Establish active timer for position 1
			await (
				core as unknown as { setResponseTimer: (pos: number) => Promise<void> }
			).setResponseTimer(1);
			expect(core.timerStateAccessor.runningPos).toBe(1);

			// Advance 10.5 seconds
			jest.advanceTimersByTime(10_500);
			expect(core.timerStateAccessor.elapsedMs()).toBe(10_500);

			const timeoutHandler = jest.fn();
			(room as unknown as { emitter: EventEmitter }).emitter.on(
				"FINISH_DUEL_BY_TIMEOUT",
				timeoutHandler,
			);

			// Intercept sendTimeLimitMessage with deferred Promise to suspend during reschedule
			let resolveSendTimeLimit: () => void;
			const sendTimeLimitPromise = new Promise<void>((resolve) => {
				resolveSendTimeLimit = resolve;
			});
			jest.spyOn(core, "sendTimeLimitMessage").mockImplementation(() => sendTimeLimitPromise);

			// Trigger rescheduleTimerAfterConfirm for side 1 (team 1)
			const reschedulePromise = core.rescheduleTimerAfterConfirm(1);

			// While suspended at sendTimeLimitMessage, dispose the core
			await core.dispose();

			// Resume sendTimeLimitMessage
			resolveSendTimeLimit!();
			await reschedulePromise;

			// Advance remaining 439.5 seconds
			jest.advanceTimersByTime(439_500);

			expect(timeoutHandler).not.toHaveBeenCalled();
			expect(logger.info).not.toHaveBeenCalledWith("Response timeout", expect.anything());
			expect(core.timerStateAccessor.runningPos).toBeUndefined();
			expect(fakeWorker.dispose).toHaveBeenCalledTimes(1);
		} finally {
			jest.useRealTimers();
		}
	});

	it("triggers timeout correctly when time runs out on an active OCGCore", async () => {
		jest.useFakeTimers();
		try {
			const room = makeRoom();
			makeClient(room, "P1");
			makeClient(room, "P2");
			const logger = makeLogger();
			const core = new OCGCore(room, logger as unknown as Logger);
			const fakeWorker = makeFakeOcgcore();
			injectFakeOcgcore(core, fakeWorker);

			core.resetResponseRequestState();

			// Establish active timer for position 1
			await (
				core as unknown as { setResponseTimer: (pos: number) => Promise<void> }
			).setResponseTimer(1);
			expect(core.timerStateAccessor.runningPos).toBe(1);

			// Advance 10.5 seconds
			jest.advanceTimersByTime(10_500);
			expect(core.timerStateAccessor.elapsedMs()).toBe(10_500);

			const timeoutHandler = jest.fn();
			(room as unknown as { emitter: EventEmitter }).emitter.on(
				"FINISH_DUEL_BY_TIMEOUT",
				timeoutHandler,
			);

			// Normal reschedule completes while active
			await core.rescheduleTimerAfterConfirm(1);
			expect(core.timerStateAccessor.runningPos).toBe(1);
			expect(core.timerStateAccessor.leftMs[1]).toBe(439_500);

			// Advance remaining 439.5 seconds
			jest.advanceTimersByTime(439_500);

			expect(timeoutHandler).toHaveBeenCalledTimes(1);
			expect(timeoutHandler).toHaveBeenCalledWith(
				expect.objectContaining({
					player: 0,
					type: 3,
				}),
				room,
				undefined,
			);
			expect(logger.info).toHaveBeenCalledWith("Response timeout", { originalDuelPos: 1 });
			expect(core.timerStateAccessor.runningPos).toBeUndefined();
		} finally {
			jest.useRealTimers();
		}
	});
});
