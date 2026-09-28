import { Pool } from "pg";
import dotenv from "dotenv";
import { classifyDeck } from "../src/shared/deck/domain/classifier/DeckClassifier";
import { CdbCardAliasProvider } from "../src/shared/deck/infrastructure/cdb/CdbCardAliasProvider";

dotenv.config();

async function main() {
	const host = process.env.POSTGRES_HOST ?? "127.0.0.1";
	const port = process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432;
	const database = process.env.POSTGRES_DB ?? "evolution";
	const user = process.env.POSTGRES_USER ?? "evolution";
	const password = process.env.POSTGRES_PASSWORD ?? "your-postgres-password";

	const pool = new Pool({ host, port, database, user, password });

	console.log(`Connecting to PostgreSQL ${user}@${host}:${port}/${database}...`);
	const client = await pool.connect();

	try {
		console.log("Loading card aliases from CDB...");
		const aliasProvider = new CdbCardAliasProvider();
		const aliases = await aliasProvider.getAliases("1109");
		console.log(`Loaded ${aliases.size} aliases.`);

		console.log("Fetching 1109 match_decks...");
		const res = await client.query<{
			match_id: string;
			deck_type_code: string;
			classifier_version: string;
			main_cards: number[];
		}>(`
			SELECT match_id, deck_type_code, classifier_version, main_cards
			FROM match_decks
			WHERE format_id = '1109'
		`);

		console.log(`Found ${res.rows.length} 1109 decks to evaluate.`);

		let updatedCount = 0;
		const changeStats: Record<string, number> = {};

		await client.query("BEGIN");

		for (const row of res.rows) {
			const classification = classifyDeck("1109", row.main_cards, aliases);

			if (
				classification.deckTypeCode !== row.deck_type_code ||
				classification.classifierVersion !== row.classifier_version
			) {
				await client.query(
					`
					UPDATE match_decks
					SET deck_type_code = $1, classifier_version = $2
					WHERE match_id = $3
				`,
					[classification.deckTypeCode, classification.classifierVersion, row.match_id],
				);

				updatedCount++;
				const transition = `${row.deck_type_code} -> ${classification.deckTypeCode}`;
				changeStats[transition] = (changeStats[transition] || 0) + 1;
			}
		}

		await client.query("COMMIT");

		console.log("\n========================================");
		console.log(`Reclassification Complete!`);
		console.log(`Total decks scanned: ${res.rows.length}`);
		console.log(`Total decks updated: ${updatedCount}`);
		console.log("\nClassification Changes:");
		for (const [trans, cnt] of Object.entries(changeStats).sort((a, b) => b[1] - a[1])) {
			console.log(`  ${trans.padEnd(25)}: ${cnt}`);
		}
		console.log("========================================\n");
	} catch (err) {
		await client.query("ROLLBACK");
		console.error("Reclassification failed:", err);
		process.exit(1);
	} finally {
		client.release();
		await pool.end();
	}
}

if (require.main === module) {
	main().catch(console.error);
}
