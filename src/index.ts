import debug from './debug/index.js';
import type {
	AppOptions,
	ParseState
} from './types.js';

export * from './types.js';

const { log } = debug('main2');

export default async function main2(opts: AppOptions): Promise<ParseState | unknown> {
	const { parse } = await import('./parser/parse.js');
	const results = await parse({
		argv:   opts.argv || process.argv.slice(2),
		env:    process.env,
		schema: opts.schema
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
