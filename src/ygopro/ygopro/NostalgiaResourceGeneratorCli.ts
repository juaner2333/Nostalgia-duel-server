import { validateLfListFile, type ValidateLfListFileOptions } from "./NostalgiaResourceGenerator";

export async function runNostalgiaResourceGenerator(arguments_: string[]): Promise<void> {
	const options = parseArguments(arguments_);
	const validated = await validateLfListFile(options);
	process.stdout.write(
		`${JSON.stringify({
			lflistPath: options.lflistPath,
			cardCount: validated.cardIds.size,
			hash: validated.hash,
			sha256: validated.sha256,
		})}\n`,
	);
}

function parseArguments(arguments_: string[]): ValidateLfListFileOptions {
	const options: Partial<ValidateLfListFileOptions> = {};
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === "--cdb") {
			options.cdbPath = readArgumentValue(arguments_, ++index, argument);
			continue;
		}
		if (argument === "--lflist") {
			options.lflistPath = readArgumentValue(arguments_, ++index, argument);
			continue;
		}
		throw new Error(`unknown argument: ${argument}`);
	}

	if (!options.cdbPath || !options.lflistPath) {
		throw new Error("required arguments: --cdb, --lflist");
	}
	return {
		cdbPath: options.cdbPath,
		lflistPath: options.lflistPath,
	};
}

function readArgumentValue(arguments_: string[], index: number, option: string): string {
	const value = arguments_[index];
	if (!value || value.startsWith("--")) {
		throw new Error(`${option} requires a value`);
	}
	return value;
}

if (process.argv[1]?.endsWith("NostalgiaResourceGeneratorCli.js")) {
	runNostalgiaResourceGenerator(process.argv.slice(2)).catch((error) => {
		process.stderr.write(`${String(error)}\n`);
		process.exitCode = 1;
	});
}
