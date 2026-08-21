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
} from "./NostalgiaResourceGenerator";

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

		fs.writeFileSync(
			lflistPath,
			"# Fixed nostalgia format 1103\n!OCG 1103\n$whitelist\n#forbidden\n1 0\n#limit\n#semi limit\n#unlimited\n4 3\n",
			"utf-8",
		);

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

	it("writes a lock and rejects missing or drifted fixed resources", async () => {
		const resourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nostalgia-lock-"));
		const cdbPath = path.join(resourceRoot, "ygopro", "base", "cards.cdb");
		const format1103Dir = path.join(resourceRoot, "ygopro", "formats", "1103");
		const format1109Dir = path.join(resourceRoot, "ygopro", "formats", "1109");
		fs.mkdirSync(path.join(resourceRoot, "ygopro", "base", "script"), { recursive: true });
		fs.mkdirSync(path.join(format1103Dir, "script"), { recursive: true });
		fs.mkdirSync(path.join(format1109Dir, "script"), { recursive: true });
		const SQL = await initSqlJs();
		const database = new SQL.Database();
		database.run("CREATE TABLE datas (id INTEGER PRIMARY KEY)");
		database.run("INSERT INTO datas (id) VALUES (1), (2), (3), (4)");
		fs.writeFileSync(cdbPath, Buffer.from(database.export()));
		for (const script of ["constant.lua", "procedure.lua", "utility.lua", "c1.lua"]) {
			fs.writeFileSync(
				path.join(resourceRoot, "ygopro", "base", "script", script),
				script,
				"utf-8",
			);
		}
		fs.writeFileSync(
			path.join(format1103Dir, "lflist.conf"),
			"# Fixed nostalgia format 1103\n!OCG 1103\n$whitelist\n#forbidden\n1 0\n#limit\n#semi limit\n#unlimited\n4 3\n",
			"utf-8",
		);
		fs.writeFileSync(
			path.join(format1109Dir, "lflist.conf"),
			"# Fixed nostalgia format 1109\n!OCG 1109\n$whitelist\n#forbidden\n1 0\n#limit\n2 1\n#semi limit\n3 2\n#unlimited\n4 3\n",
			"utf-8",
		);

		const lockPath = path.join(resourceRoot, "lock.json");
		await writeNostalgiaResourceLock(resourceRoot, lockPath);
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).resolves.toBeUndefined();
		fs.appendFileSync(path.join(format1103Dir, "lflist.conf"), "# drift\n", "utf-8");
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow("drift");
		fs.rmSync(path.join(format1103Dir, "lflist.conf"));
		await expect(checkNostalgiaResourceLock(resourceRoot, lockPath)).rejects.toThrow();
		fs.rmSync(resourceRoot, { recursive: true, force: true });
	});
});
