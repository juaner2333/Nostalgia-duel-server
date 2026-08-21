import path from "node:path";
import { checkNostalgiaResourceLock } from "./NostalgiaResourceGenerator";

export async function runNostalgiaResourceGenerator(arguments_: string[]): Promise<void> {
	const resourceRoot = parseResourceRoot(arguments_);
	const lockPath = path.join(resourceRoot, "lock.json");
	await checkNostalgiaResourceLock(resourceRoot, lockPath);
	process.stdout.write(`nostalgia-resources integrity check passed: ${lockPath}\n`);
}

function parseResourceRoot(arguments_: string[]): string {
	let resourceRoot: string | undefined;
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === "--root") {
			resourceRoot = arguments_[++index];
			if (!resourceRoot || resourceRoot.startsWith("--")) {
				throw new Error("--root requires a value");
			}
			continue;
		}
		throw new Error(`unknown argument: ${argument}`);
	}

	if (!resourceRoot) {
		throw new Error("required argument: --root");
	}
	return resourceRoot;
}

if (process.argv[1]?.endsWith("NostalgiaResourceGeneratorCli.js")) {
	runNostalgiaResourceGenerator(process.argv.slice(2)).catch((error) => {
		process.stderr.write(`${String(error)}\n`);
		process.exitCode = 1;
	});
}
