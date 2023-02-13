import debug from './debug/index.js';
import { parse } from './parser/parse.js';
import {
	AppOptions,
	ParseState
} from './types.js';

export * from './types.js';

const { log } = debug('main2');

export default async function main2(opts: AppOptions): Promise<ParseState | unknown> {
	const results = await parse({
		argv:   opts.argv || process.argv.slice(2),
		env:    process.env,
		schema: opts.schema
	});

	const { cmd } = results;
	if (cmd?.run) {
		log(`Executing command "${cmd.name}"`);
		return (await cmd.run(results)) ?? results;
	}

	return results;
}
