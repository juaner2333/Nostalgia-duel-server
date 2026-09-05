import { PlayerMother } from "@test-support/mothers/player/PlayerMother";

describe("Player.calculateMatchPoints()", () => {
	it("awards 3 points to the winner of a 2:0 match", () => {
		const player = PlayerMother.create({
			winner: true,
			games: [
				{ result: "winner", turns: 5, ipAddress: null },
				{ result: "winner", turns: 6, ipAddress: null },
			],
		});

		expect(player.calculateMatchPoints()).toBe(3);
	});

	it("awards 2 points to the winner of a 2:1 match", () => {
		const player = PlayerMother.create({
			winner: true,
			games: [
				{ result: "winner", turns: 5, ipAddress: null },
				{ result: "loser", turns: 6, ipAddress: null },
				{ result: "winner", turns: 7, ipAddress: null },
			],
		});

		expect(player.calculateMatchPoints()).toBe(2);
	});

	it("deducts 1 point from the loser of a 1:2 match", () => {
		const player = PlayerMother.create({
			winner: false,
			games: [
				{ result: "winner", turns: 5, ipAddress: null },
				{ result: "loser", turns: 6, ipAddress: null },
				{ result: "loser", turns: 7, ipAddress: null },
			],
		});

		expect(player.calculateMatchPoints()).toBe(-1);
	});

	it("deducts 2 points from the loser of a 0:2 match", () => {
		const player = PlayerMother.create({
			winner: false,
			games: [
				{ result: "loser", turns: 5, ipAddress: null },
				{ result: "loser", turns: 6, ipAddress: null },
			],
		});

		expect(player.calculateMatchPoints()).toBe(-2);
	});

	it("ignores deuce games when calculating match points", () => {
		const player = PlayerMother.create({
			winner: true,
			games: [
				{ result: "deuce", turns: 5, ipAddress: null },
				{ result: "winner", turns: 6, ipAddress: null },
				{ result: "winner", turns: 7, ipAddress: null },
			],
		});

		expect(player.calculateMatchPoints()).toBe(3);
	});
});
