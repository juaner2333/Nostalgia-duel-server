import { LeaderboardPageController } from "./LeaderboardPageController";
import { Request, Response } from "express";
import { config } from "src/config";

function fakeResponse(): {
	res: Response;
	text: () => string;
	status: () => number;
	json: () => any;
	header: (name: string) => string | undefined;
} {
	let statusCode = 200;
	let textPayload = "";
	let jsonPayload: any = null;
	const headers: Record<string, string> = {};

	const res = {
		status(code: number) {
			statusCode = code;
			return this;
		},
		send(data: any) {
			textPayload = String(data);
			return this;
		},
		json(data: any) {
			jsonPayload = data;
			return this;
		},
		type(_type: string) {
			return this;
		},
		setHeader(name: string, value: string) {
			headers[name.toLowerCase()] = value;
			return this;
		},
	} as unknown as Response;

	return {
		res,
		text: () => textPayload,
		status: () => statusCode,
		json: () => jsonPayload,
		header: (name: string) => headers[name.toLowerCase()],
	};
}

const fakeRequest = (request: Partial<Request>): Request => request as Request;

describe("LeaderboardPageController", () => {
	let controller: LeaderboardPageController;
	const originalRanking = config.ranking.enabled;

	beforeEach(() => {
		config.ranking.enabled = true;
		controller = new LeaderboardPageController();
	});

	afterEach(() => {
		config.ranking.enabled = originalRanking;
	});

	it("returns 200 and renders 3-tab page for format 1103 without authentication", () => {
		const out = fakeResponse();
		controller.run(fakeRequest({ params: { format: "1103" } }), out.res);

		expect(out.status()).toBe(200);
		const html = out.text();
		expect(html).toContain("1103");
		expect(html).toContain("房间列表");
		expect(html).toContain("录像下载");
		expect(html).toContain("天梯排行");
	});

	it("returns 200 and renders 3-tab page for format 1109 without authentication", () => {
		const out = fakeResponse();
		controller.run(fakeRequest({ params: { format: "1109" } }), out.res);

		expect(out.status()).toBe(200);
		const html = out.text();
		expect(html).toContain("1109");
		expect(html).toContain("房间列表");
		expect(html).toContain("录像下载");
		expect(html).toContain("天梯排行");
	});

	it("uses Nostalgia Duel Server branding and does not contain SRVPro or language switcher", () => {
		const out = fakeResponse();
		controller.run(fakeRequest({ params: { format: "1103" } }), out.res);

		const html = out.text();
		expect(html).toContain("Nostalgia Duel Server");
		expect(html).not.toContain("SRVPro");
		expect(html).not.toContain("srvpro");
		expect(html).not.toContain("Language");
		expect(html).not.toContain("English");
		expect(html).not.toContain("多语言");
	});

	it("returns 404 for unknown or unsupported format", () => {
		const out = fakeResponse();
		controller.run(fakeRequest({ params: { format: "9999" } }), out.res);

		expect(out.status()).toBe(404);
	});

	it("returns 503 when ranking is disabled", () => {
		config.ranking.enabled = false;
		const out = fakeResponse();
		controller.run(fakeRequest({ params: { format: "1103" } }), out.res);

		expect(out.status()).toBe(503);
	});

	it("does not expose account ID, userId, PIN, IP, or password fields in the page template", () => {
		const out = fakeResponse();
		controller.run(fakeRequest({ params: { format: "1103" } }), out.res);

		const html = out.text();
		expect(html).not.toContain("userId");
		expect(html).not.toContain("user_id");
		expect(html).not.toContain("rankedPin");
		expect(html).not.toContain("password");
		expect(html).not.toContain("ipAddress");
	});

	it("references only format-scoped APIs (/api/getrooms, /api/replays/:format, /api/leaderboards/:format)", () => {
		const out1103 = fakeResponse();
		controller.run(fakeRequest({ params: { format: "1103" } }), out1103.res);
		const html1103 = out1103.text();

		expect(html1103).toContain('var FORMAT = "1103";');
		expect(html1103).toContain("/api/getrooms");
		expect(html1103).toContain('"/api/replays/" + FORMAT');
		expect(html1103).toContain('"/api/leaderboards/" + FORMAT');
		expect(html1103).not.toContain('"1109"');

		const out1109 = fakeResponse();
		controller.run(fakeRequest({ params: { format: "1109" } }), out1109.res);
		const html1109 = out1109.text();

		expect(html1109).toContain('var FORMAT = "1109";');
		expect(html1109).toContain("/api/getrooms");
		expect(html1109).toContain('"/api/replays/" + FORMAT');
		expect(html1109).toContain('"/api/leaderboards/" + FORMAT');
		expect(html1109).not.toContain('"1103"');
	});
});
