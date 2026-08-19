import { ISocket } from "@shared/socket/domain/ISocket";
import { YgoClient } from "@shared/client/domain/YgoClient";
import { YgoRoom } from "./YgoRoom";
import { SimpleRoomMother } from "@test-support/mothers/room/SimpleRoomMother";

// YgoClient has no abstract members — a trivial concrete subclass is enough
// to exercise room player-list mutations.
class TestClient extends YgoClient {}

function makeClient(id: string): TestClient {
	const socket = { id, remoteAddress: "::1" } as unknown as ISocket;
	return new TestClient({ name: `P-${id}`, position: 0, team: 0, socket, host: false, id });
}

describe("YgoRoom", () => {
	describe("Lock-Free", () => {
		let room: ReturnType<typeof SimpleRoomMother.create>;

		beforeEach(() => {
			room = SimpleRoomMother.create();
		});

		it("evita condiciones de carrera al agregar jugadores concurrently", async () => {
			const c1 = makeClient("1");
			const c2 = makeClient("2");

			room.mutex.runExclusive(() => {
				room.players.push(c1);
			});
			room.mutex.runExclusive(() => {
				room.players.push(c2);
			});

			await new Promise((r) => {
				setTimeout(r, 30);
			});

			expect(room.players.length).toBe(2);
			expect(room.players).toContain(c1);
			expect(room.players).toContain(c2);
		});

		it("removePlayer se ejecuta de forma segura y secuencial", async () => {
			const c1 = makeClient("1");
			const c2 = makeClient("2");

			room.mutex.runExclusive(() => {
				room.players.push(c1);
			});
			room.mutex.runExclusive(() => {
				room.players.push(c2);
			});
			room.mutex.runExclusive(() => room.removePlayer(c1));

			await new Promise((r) => {
				setTimeout(r, 30);
			});

			expect(room.players.length).toBe(1);
			expect(room.players[0]).toBe(c2);
		});

		it("permite ejecutar lógica síncrona dentro del mutex (simulando pattern Unsafe) sin deadlock", async () => {
			const c1 = makeClient("1");
			const c2 = makeClient("2");

			await room.mutex.runExclusive(() => {
				// Simula addPlayerUnsafe síncrono
				room.players.push(c1);

				// Simula lógica adicional que depende del estado actualizado inmediatamente
				if (room.players.includes(c1)) {
					room.players.push(c2);
				}
			});

			expect(room.players.length).toBe(2);
			expect(room.players[0]).toBe(c1);
			expect(room.players[1]).toBe(c2);
		});
	});
});
