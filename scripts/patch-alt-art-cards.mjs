#!/usr/bin/env node
/**
 * One-off data migration: add alternate-art ("+1 code") cards to the fixed
 * nostalgia cards.cdb and to the 1103/1109 whitelists.
 *
 * The client card libraries contain alternate-art entries whose code is the
 * original code plus a small offset (e.g. 70095155 -> 70095154). The server
 * only contained the base code, so deck validation failed with UnknownCardError.
 *
 * This script is purely additive / idempotent:
 *   - copies each new `datas`/`texts` row from the matching server base card,
 *     setting `datas.alias = base_code` so ban-limit grouping and engine alias
 *     semantics match EDOPro;
 *   - skips token rows (TYPE_TOKEN bit 0x4000) — tokens are not whitelisted and
 *     would break the resource-lock token assertions;
 *   - appends each added code to the 1103/1109 whitelists where its base card
 *     is already whitelisted, mirroring the base card's quantity.
 *
 * After running, regenerate the lock:
 *   npm run build && npm run generate:nostalgia-lock
 */
import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const ROOT = process.cwd();
const CDB = path.join(ROOT, "nostalgia-resources", "ygopro", "base", "cards.cdb");
const CSV = path.join(ROOT, "patches", "alt-art-patch-list.csv");
const FORMATS = {
	1103: path.join(ROOT, "nostalgia-resources", "ygopro", "formats", "1103", "lflist.conf"),
	1109: path.join(ROOT, "nostalgia-resources", "ygopro", "formats", "1109", "lflist.conf"),
};

const TYPE_TOKEN = 0x4000;

function parseCsv(text) {
	const lines = text.trim().split(/\r?\n/);
	if (lines[0].trim().toLowerCase() !== "add_code,base_code,delta,cn_name,en_name") {
		throw new Error("unexpected CSV header");
	}
	return lines.slice(1).map((line) => {
		const [add, base, delta, cn, en] = line.split(",");
		return {
			add: Number(add),
			base: Number(base),
			delta: Number(delta),
			cn: (cn ?? "").trim(),
			en: (en ?? "").trim(),
		};
	});
}

function readWhitelist(text) {
	const lines = text.split(/\r?\n/);
	const index = lines.findIndex((l) => l.trim() === "$whitelist");
	if (index === -1) throw new Error("whitelist marker missing");
	const map = new Map();
	for (const line of lines.slice(index + 1)) {
		const match = /^(\d+)\s+([0-3])/.exec(line.trim());
		if (match) map.set(Number(match[1]), Number(match[2]));
	}
	return map;
}

function buildWhitelistText(text, additions) {
	// strip any previously-applied trailing ALT-ART FIX block so the script
	// stays idempotent (header and the numeric lines that follow it)
	const lines = text.split(/\r?\n/);
	const start = lines.findIndex((l) =>
		l.startsWith("# ALT-ART FIX: alternate-art codes mirrored from their base card quantities"),
	);
	const filtered = start >= 0 ? lines.slice(0, start) : lines;
	const clean = filtered.join("\n");
	const block = [
		`# ALT-ART FIX: alternate-art codes mirrored from their base card quantities (n=${additions.length})`,
		...additions.map(({ add, qty }) => `${add} ${qty}`),
		"",
	].join("\n");
	// append after the whitelist block (end of file)
	const trimmed = clean.endsWith("\n") ? clean : `${clean}\n`;
	return trimmed + block;
}

async function main() {
	const rows = parseCsv(fs.readFileSync(CSV, "utf8"));
	if (rows.length === 0) throw new Error("no rows");

	const SQL = await initSqlJs();
	const db = new SQL.Database(fs.readFileSync(CDB));

	// existing ids
	const dataIds = new Set(db.exec("SELECT id FROM datas")[0].values.map((r) => Number(r[0])));
	const existing = db.exec("SELECT id, type FROM datas")[0].values;
	const serverTypes = new Map(existing.map((r) => [Number(r[0]), Number(r[1])]));

	const inserted = [];
	const skippedToken = [];
	const skippedDuplicate = [];

	const datasCols = "ot, alias, setcode, type, atk, def, level, race, attribute, category".split(
		", ",
	);
	const textsCols =
		"name, desc, str1, str2, str3, str4, str5, str6, str7, str8, str9, str10, str11, str12, str13, str14, str15, str16".split(
			", ",
		);

	db.run("BEGIN");
	try {
		for (const row of rows) {
			if (dataIds.has(row.add)) {
				skippedDuplicate.push(row);
				continue;
			}
			if (!serverTypes.has(row.base)) {
				throw new Error(`base code not in server cdb: ${row.base} (${row.cn})`);
			}
			if (serverTypes.get(row.base) & TYPE_TOKEN) {
				skippedToken.push(row);
				continue;
			}
			// copy datas row, override id + alias
			const baseDatas = db.exec(
				`SELECT ${datasCols.join(", ")} FROM datas WHERE id = ${row.base}`,
			)[0].values[0];
			db.run(
				`INSERT INTO datas (id, ${datasCols.join(", ")}) VALUES (?, ${datasCols
					.map(() => "?")
					.join(", ")})`,
				[row.add, ...baseDatas.slice(0, 1), row.base, ...baseDatas.slice(2)],
			);
			// copy texts row verbatim, override id
			const baseTexts = db.exec(
				`SELECT ${textsCols.join(", ")} FROM texts WHERE id = ${row.base}`,
			)[0].values[0];
			db.run(
				`INSERT INTO texts (id, ${textsCols.join(", ")}) VALUES (?, ${textsCols
					.map(() => "?")
					.join(", ")})`,
				[row.add, ...baseTexts],
			);
			inserted.push(row);
		}
		db.run("COMMIT");
	} catch (error) {
		db.run("ROLLBACK");
		throw error;
	}

	const patchedCdb = Buffer.from(db.export());
	db.close();
	fs.writeFileSync(CDB, patchedCdb);

	// whitelist updates — converge to the FULL set of eligible alt-art codes whose
	// base card is whitelisted (idempotent and safe for incremental re-runs): the
	// old marker block is stripped and re-written with every eligible row, so
	// previously-applied codes are never dropped when more are added later.
	const eligibleForWhitelist = rows.filter(
		(row) => serverTypes.has(row.base) && (serverTypes.get(row.base) & TYPE_TOKEN) === 0,
	);
	for (const formatId of Object.keys(FORMATS)) {
		const lflistPath = FORMATS[formatId];
		const text = fs.readFileSync(lflistPath, "utf8");
		const whitelist = readWhitelist(text);
		const additions = [];
		for (const row of eligibleForWhitelist) {
			const qty = whitelist.get(row.base);
			if (qty === undefined) continue; // base card not in this format
			additions.push({ add: row.add, qty });
		}
		if (additions.length === 0) {
			console.log(`format ${formatId}: no eligible alt-art codes for this format`);
			continue;
		}
		const next = buildWhitelistText(text, additions);
		fs.writeFileSync(lflistPath, next);
		const nextWl = readWhitelist(next);
		console.log(
			`format ${formatId}: ensured ${additions.length} alt-art codes in whitelist -> ${nextWl.size}`,
		);
	}

	// counts
	const newDataIds = new Set(
		new SQL.Database(patchedCdb).exec("SELECT id FROM datas")[0].values.map((r) => Number(r[0])),
	);
	console.log("\nbase cdb: card count", dataIds.size, "->", newDataIds.size);
	console.log("inserted:", inserted.length);
	console.log("skipped (token, would break pool):", skippedToken.length);
	skippedToken.forEach((r) => console.log(`   skip token: ${r.add} (${r.cn})`));
	console.log("skipped (already present):", skippedDuplicate.length);
	skippedDuplicate.forEach((r) => console.log(`   skip dup: ${r.add} (${r.cn})`));

	if (newDataIds.size !== dataIds.size + inserted.length) {
		throw new Error("cdb size invariant violated");
	}
	console.log("\npatch complete");
}

main().catch((error) => {
	console.error("patch failed:", error);
	process.exit(1);
});
