import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import {
	readCdbCardIds,
	validateLfListFile,
	validateWhitelist,
	checkNostalgiaResourceLock,
	writeNostalgiaResourceLock,
	assertFixedPoolSizes,
} from "./NostalgiaResourceGenerator";

const LFLIST_1103 =
	"# Fixed nostalgia format 1103\n!OCG 1103\n$whitelist\n#forbidden\n1 0\n#limit\n#semi limit\n#unlimited\n4 3\n";
const LFLIST_1109 =
	"# Fixed nostalgia format 1109\n!OCG 1109\n$whitelist\n#forbidden\n1 0\n#limit\n2 1\n#semi limit\n3 2\n#unlimited\n4 3\n";

// 固定环境卡池规模（与 EXPECTED_NOSTALGIA_POOL_SIZES 一致）：fixture 按此规模
// 生成，使 lock 校验通过且与生产门禁使用同一条路径。
const BASE_POOL_SIZE = 5399;
const POOL_1103_SIZE = 5197;
const POOL_1109_SIZE = 5310;
const TYPE_TOKEN = 0x4000;

describe("NostalgiaResourceGenerator", () => {
	it("reads unique valid CDB card IDs", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nostalgia-cdb-"));
		const cdbPath = path.join(dir, "cards.cdb");
		const SQL = await initSqlJs();
		const database = new SQL.Database();
		database.run("CREATE TABLE datas (id INTEGER PRIMARY KEY)");
		database.run("INSERT INTO datas (id) VALUES (1), (2), (3), (4)");
		fs.writeFileSync(cdbPath, Buffer.from(database.export()));

		await expect(readCdbCardIds(cdbPath)).resolves.toEqual([1, 2, 3, 4]);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("rejects duplicate or invalid CDB card IDs", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nostalgia-invalid-cdb-"));
		const duplicatePath = path.join(dir, "duplicate.cdb");
		const invalidPath = path.join(dir, "invalid.cdb");
		const SQL = await initSqlJs();
		const duplicateDatabase = new SQL.Database();
		duplicateDatabase.run("CREATE TABLE datas (id INTEGER)");
		duplicateDatabase.run("INSERT INTO datas (id) VALUES (1), (1)");
		fs.writeFileSync(duplicatePath, Buffer.from(duplicateDatabase.export()));
		const invalidDatabase = new SQL.Database();
		invalidDatabase.run("CREATE TABLE datas (id INTEGER)");
		invalidDatabase.run("INSERT INTO datas (id) VALUES (0)");
		fs.writeFileSync(invalidPath, Buffer.from(invalidDatabase.export()));

		await expect(readCdbCardIds(duplicatePath)).rejects.toThrow("duplicate");
		await expect(readCdbCardIds(invalidPath)).rejects.toThrow("invalid");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("validates a format whitelist directly against the fixed CDB", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nostalgia-generate-"));
		const cdbPath = path.join(dir, "cards.cdb");
		const lflistPath = path.join(dir, "1103-lflist.conf");
		const SQL = await initSqlJs();
		const database = new SQL.Database();
		database.run("CREATE TABLE datas (id INTEGER PRIMARY KEY)");
		database.run("INSERT INTO datas (id) VALUES (1), (2), (3), (4)");
		fs.writeFileSync(cdbPath, Buffer.from(database.export()));

		fs.writeFileSync(lflistPath, LFLIST_1103, "utf-8");

		const validated = await validateLfListFile({
			cdbPath,
			lflistPath,
		});

		expect(validated.cardIds).toEqual(new Set([1, 4]));
		expect(validated.quantities).toEqual(
			new Map([
				[1, 0],
				[4, 3],
			]),
		);
		fs.appendFileSync(lflistPath, "2 0\n", "utf-8");
		await expect(
			validateLfListFile({
				cdbPath,
				lflistPath,
			}),
		).resolves.toMatchObject({ cardIds: new Set([1, 2, 4]) });
		fs.appendFileSync(lflistPath, "999 3\n", "utf-8");
		await expect(validateLfListFile({ cdbPath, lflistPath })).rejects.toThrow("database-external");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("rejects malformed direct format whitelists", () => {
		expect(() => validateWhitelist("!broken\n$whitelist\n1 4\n", new Set([1]))).toThrow("quantity");
		expect(() => validateWhitelist("!broken\n$whitelist\n1 3\n1 2\n", new Set([1]))).toThrow(
			"duplicate",
		);
		expect(() => validateWhitelist("!broken\n$whitelist\n1 3\n", new Set([2]))).toThrow(
			"card pool",
		);
	});

	it("locks the fixed card pool sizes (5399 / 5197 / 5310)", () => {
		const fixedSizes = {
			inputs: { baseDatabase: { count: BASE_POOL_SIZE } },
			formats: {
				"1103": { cardPool: { count: POOL_1103_SIZE } },
				"1109": { cardPool: { count: POOL_1109_SIZE } },
			},
		};
		expect(() => assertFixedPoolSizes(fixedSizes)).not.toThrow();
		expect(() =>
			assertFixedPoolSizes({
				inputs: { baseDatabase: { count: 4 } },
				formats: {
					"1103": { cardPool: { count: 4 } },
					"1109": { cardPool: { count: 4 } },
				},
			}),
		).toThrow("base card pool mismatch: expected 5399, got 4");
		expect(() =>
			assertFixedPoolSizes({
				inputs: { baseDatabase: { count: BASE_POOL_SIZE } },
				formats: {
					"1103": { cardPool: { count: 4 } },
					"1109": { cardPool: { count: POOL_1109_SIZE } },
				},
			}),
		).toThrow("format 1103 card pool mismatch: expected 5197, got 4");
	});

	it("writes a lock and rejects missing or drifted fixed resources", async () => {
		const resourceRoot = await buildLockFixture();
		const lockPath = path.join(resourceRoot, "lock.json");
		await writeNostalgiaResourceLock(resourceRoot, lockPath);
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).resolves.toBeUndefined();
		fs.appendFileSync(
			path.join(resourceRoot, "ygopro", "formats", "1103", "lflist.conf"),
			"# drift\n",
			"utf-8",
		);
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow("drift");
		fs.rmSync(path.join(resourceRoot, "ygopro", "formats", "1103", "lflist.conf"));
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow();
		fs.rmSync(resourceRoot, { recursive: true, force: true });
	});

	it("rejects a missing lock file and a missing base database", async () => {
		const resourceRoot = await buildLockFixture();
		const lockPath = path.join(resourceRoot, "lock.json");
		await writeNostalgiaResourceLock(resourceRoot, lockPath);

		await expect(
			checkNostalgiaResourceLock(resourceRoot, path.join(resourceRoot, "missing-lock.json")),
		).rejects.toThrow("resource lock missing");
		fs.rmSync(path.join(resourceRoot, "ygopro", "base", "cards.cdb"));
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow();
		fs.rmSync(resourceRoot, { recursive: true, force: true });
	});

	it("rejects CDB and Lua script drift after the lock is written", async () => {
		const resourceRoot = await buildLockFixture();
		const lockPath = path.join(resourceRoot, "lock.json");
		await writeNostalgiaResourceLock(resourceRoot, lockPath);

		// 同数量、同 ID 集合但内容不同的基础数据库：卡池规模与白名单
		// 校验不受影响，必须仍被 lock 逐字比较拒绝。
		const SQL = await initSqlJs();
		const database = new SQL.Database();
		database.run("CREATE TABLE datas (id INTEGER PRIMARY KEY, type INTEGER DEFAULT 0, name TEXT)");
		database.run(
			`INSERT INTO datas (id, name) VALUES ${range(1, BASE_POOL_SIZE)
				.map((id) => `(${id}, 'drifted')`)
				.join(",")}`,
		);
		fs.writeFileSync(
			path.join(resourceRoot, "ygopro", "base", "cards.cdb"),
			Buffer.from(database.export()),
		);
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow("drift");

		fs.writeFileSync(
			path.join(resourceRoot, "ygopro", "base", "script", "c1.lua"),
			"-- drifted script\n",
			"utf-8",
		);
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow("drift");
		fs.rmSync(resourceRoot, { recursive: true, force: true });
	});

	it("rejects script token references missing from the base CDB", async () => {
		const resourceRoot = await buildLockFixture({
			tokenScript: "local t=Duel.CreateToken(tp,44330099)\n",
		});
		const lockPath = path.join(resourceRoot, "lock.json");
		await expect(writeNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow(
			"script token references missing from base CDB: 44330099",
		);
		fs.rmSync(resourceRoot, { recursive: true, force: true });
	});

	it("rejects base CDB tokens not referenced by any script", async () => {
		const resourceRoot = await buildLockFixture({ tokenCardIds: [44330099] });
		const lockPath = path.join(resourceRoot, "lock.json");
		await expect(writeNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow(
			"base CDB token cards not referenced by scripts: 44330099",
		);
		fs.rmSync(resourceRoot, { recursive: true, force: true });
	});

	it("accepts script token references backed by base CDB token cards", async () => {
		const resourceRoot = await buildLockFixture({
			tokenScript: "local t=Duel.CreateToken(tp,44330099)\n",
			tokenCardIds: [44330099],
		});
		const lockPath = path.join(resourceRoot, "lock.json");
		await writeNostalgiaResourceLock(resourceRoot, lockPath);
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).resolves.toBeUndefined();
		fs.rmSync(resourceRoot, { recursive: true, force: true });
	});

	it("rejects EDOPro trees, unknown formats, extra card pools and repo caches", async () => {
		const resourceRoot = await buildLockFixture();
		const lockPath = path.join(resourceRoot, "lock.json");
		await writeNostalgiaResourceLock(resourceRoot, lockPath);

		fs.mkdirSync(path.join(resourceRoot, "edopro"), { recursive: true });
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow("edopro");
		fs.rmSync(path.join(resourceRoot, "edopro"), { recursive: true, force: true });

		fs.mkdirSync(path.join(resourceRoot, "ygopro", "formats", "1110"), { recursive: true });
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow("1110");
		fs.rmSync(path.join(resourceRoot, "ygopro", "formats", "1110"), {
			recursive: true,
			force: true,
		});

		const SQL = await initSqlJs();
		const database = new SQL.Database();
		database.run("CREATE TABLE datas (id INTEGER PRIMARY KEY)");
		database.run("INSERT INTO datas (id) VALUES (1)");
		fs.mkdirSync(path.join(resourceRoot, "ygopro", "base", "extra"), { recursive: true });
		fs.writeFileSync(
			path.join(resourceRoot, "ygopro", "base", "extra", "cards.cdb"),
			Buffer.from(database.export()),
		);
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow("extra");
		fs.rmSync(path.join(resourceRoot, "ygopro", "base", "extra"), { recursive: true, force: true });

		fs.mkdirSync(path.join(resourceRoot, "repositories"), { recursive: true });
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow(
			"repositories",
		);
		fs.rmSync(path.join(resourceRoot, "repositories"), { recursive: true, force: true });

		fs.mkdirSync(path.join(resourceRoot, "resources", "releases"), { recursive: true });
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow("resources");
		fs.rmSync(path.join(resourceRoot, "resources"), { recursive: true, force: true });

		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).resolves.toBeUndefined();
		fs.rmSync(resourceRoot, { recursive: true, force: true });
	});

	it("rejects external script trees and non-lua files anywhere in the layout", async () => {
		const resourceRoot = await buildLockFixture();
		const lockPath = path.join(resourceRoot, "lock.json");
		await writeNostalgiaResourceLock(resourceRoot, lockPath);

		fs.mkdirSync(path.join(resourceRoot, "external-scripts"), { recursive: true });
		fs.writeFileSync(path.join(resourceRoot, "external-scripts", "evil.lua"), "evil", "utf-8");
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow(
			"external-scripts",
		);
		fs.rmSync(path.join(resourceRoot, "external-scripts"), { recursive: true, force: true });

		fs.writeFileSync(path.join(resourceRoot, "ygopro", "base", "script", "evil.txt"), "x", "utf-8");
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow("evil.txt");
		fs.rmSync(path.join(resourceRoot, "ygopro", "base", "script", "evil.txt"));

		fs.mkdirSync(path.join(resourceRoot, "ygopro", "base", "script", "sub"), { recursive: true });
		fs.writeFileSync(
			path.join(resourceRoot, "ygopro", "base", "script", "sub", "c1.lua"),
			"x",
			"utf-8",
		);
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow("sub");
		fs.rmSync(path.join(resourceRoot, "ygopro", "base", "script", "sub"), {
			recursive: true,
			force: true,
		});

		fs.writeFileSync(
			path.join(resourceRoot, "ygopro", "formats", "1103", "script", ".gitkeep"),
			"",
			"utf-8",
		);
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).resolves.toBeUndefined();
		fs.rmSync(resourceRoot, { recursive: true, force: true });
	});
});

function range(from: number, toInclusive: number): number[] {
	const values: number[] = [];
	for (let value = from; value <= toInclusive; value += 1) {
		values.push(value);
	}
	return values;
}

function buildWhitelist(from: number, toInclusive: number): string {
	const lines = ["# fixture whitelist", "$whitelist"];
	for (let cardId = from; cardId <= toInclusive; cardId += 1) {
		lines.push(`${cardId} 3`);
	}
	return `${lines.join("\n")}\n`;
}

// 生成与固定环境同规模的资源树：基础 5399 张（5320 实卡 + 79 token 元数据，
// fixture 中 token 为空集时基础卡数即 5399 张非 token 卡）、1103 白名单 5198 张、
// 1109 白名单 5310 张，使完整 lock 校验（含卡池数量断言）走生产同一条路径。
async function buildLockFixture(overrides?: {
	tokenScript?: string;
	tokenCardIds?: number[];
}): Promise<string> {
	const resourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nostalgia-lock-fixture-"));
	const cdbPath = path.join(resourceRoot, "ygopro", "base", "cards.cdb");
	const format1103Dir = path.join(resourceRoot, "ygopro", "formats", "1103");
	const format1109Dir = path.join(resourceRoot, "ygopro", "formats", "1109");
	fs.mkdirSync(path.join(resourceRoot, "ygopro", "base", "script"), { recursive: true });
	fs.mkdirSync(path.join(format1103Dir, "script"), { recursive: true });
	fs.mkdirSync(path.join(format1109Dir, "script"), { recursive: true });

	const SQL = await initSqlJs();
	const database = new SQL.Database();
	database.run("CREATE TABLE datas (id INTEGER PRIMARY KEY, type INTEGER DEFAULT 0)");
	const realCardCount = BASE_POOL_SIZE - (overrides?.tokenCardIds?.length ?? 0);
	database.run(
		`INSERT INTO datas (id) VALUES ${range(1, realCardCount)
			.map((id) => `(${id})`)
			.join(",")}`,
	);
	for (const cardId of overrides?.tokenCardIds ?? []) {
		database.run(`INSERT INTO datas (id, type) VALUES (${cardId}, ${TYPE_TOKEN | 0x1})`);
	}
	fs.writeFileSync(cdbPath, Buffer.from(database.export()));
	for (const script of ["constant.lua", "procedure.lua", "utility.lua", "c1.lua"]) {
		fs.writeFileSync(path.join(resourceRoot, "ygopro", "base", "script", script), script, "utf-8");
	}
	if (overrides?.tokenScript) {
		fs.writeFileSync(
			path.join(resourceRoot, "ygopro", "base", "script", "c2.lua"),
			overrides.tokenScript,
			"utf-8",
		);
	}
	fs.writeFileSync(
		path.join(format1103Dir, "lflist.conf"),
		buildWhitelist(1, POOL_1103_SIZE),
		"utf-8",
	);
	fs.writeFileSync(
		path.join(format1109Dir, "lflist.conf"),
		buildWhitelist(1, POOL_1109_SIZE),
		"utf-8",
	);
	return resourceRoot;
}
