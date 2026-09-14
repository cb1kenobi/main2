import { main2, type ParseState, type Schema } from 'main2';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * The toolchain's version, read from its own manifest.
 *
 * Read rather than inlined at build time so a globally linked checkout reports
 * what is actually on disk. `createRequire` rather than `readFileSync` off
 * `import.meta.url` because the built entry and the source entry sit at
 * different depths and only one of them would get the path right.
 */
export function version(): string {
	return require('../package.json').version as string;
}

/**
 * The toolchain's command schema.
 *
 * Declared here rather than inside `run()` so tests can parse against it
 * without going through a process, and so the filesystem router (M2-74) has
 * something to replace rather than something to invent.
 */
export function schema(): Schema {
	return {
		name: 'main2',
		options: {
			'-v, --version': {
				desc: "Print the toolchain's version",
				type: 'bool',
			},
		},
		// `build`, `add`, and `new` land in M2-73 and M2-75. Nothing is stubbed
		// here: a command that exists and refuses is worse than one that does not
		// exist yet, because only the second is honest in `--help`.
		commands: {},
	};
}

/**
 * Whether `main2()` handed back a parse state rather than a command's return
 * value or the `undefined` it resolves with after handling an error.
 *
 * @param value - Whatever `main2()` resolved with.
 * @returns Whether it is a state worth reading.
 */
function isParseState(value: unknown): value is ParseState {
	return !!value && typeof value === 'object' && 'argv' in value && '$' in value;
}

/**
 * Runs the toolchain.
 *
 * `--version` is answered from the returned state rather than from an
 * `afterParse` hook: that hook fires at the end of the argv walk, before
 * `processOptions()` writes anything, so `state.argv` is still empty inside it.
 *
 * @param argv - Arguments, defaulting to the process's.
 * @returns Whatever `main2()` resolves with.
 */
export async function run(argv?: string[]): Promise<ParseState | unknown> {
	const result = await main2({ argv, schema: schema() });

	// help already answered, and it outranks `--version` for the same reason it
	// outranks everything else: being asked what the program does and answering
	// something else is not an answer
	if (isParseState(result) && !result.help && result.argv.version) {
		process.stdout.write(`${version()}\n`);
	}

	return result;
}
