import debug from './debug/index.js';
import type {
	AppOptions,
	ParseState
} from './types.js';

export * from './types.js';

const { log } = debug('main2');

export async function main2(opts: AppOptions): Promise<ParseState | unknown> {
	if (opts?.settings?.assertCwd !== false) {
		assertCwd();
	}

	const { parse } = await import('./parser/parse.js');
	const results = await parse({
		argv:     opts.argv || process.argv.slice(2),
		env:      process.env,
		schema:   opts.schema,
		settings: opts.settings
	});

	let { terminal } = opts;
	if (!terminal) {
		const { Terminal } = await import('./terminal.js');
		terminal = new Terminal();
	}

	const { cmd } = results;
	if (cmd?.run) {
		log(`Executing command "${cmd.name}"`);
		return (await cmd.run(results)) ?? results;
	}

	return results;
}

function assertCwd() {
	try {
		process.cwd();
	} catch (err) {
		if (err instanceof Error && err.message.includes('uv_cwd')) {
			throw new Error('Current working directory does not exist');
		}
	}
}

export default main2;
