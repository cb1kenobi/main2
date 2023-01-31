import {
	parse,
	Schema
} from './parser/index.js';

export {
	parse
};

export async function exec(schema: Schema, argv: string[] | undefined): Promise<void> {
	const results = await parse({
		argv: argv || process.argv.slice(2),
		env: process.env,
		schema
	});

	// if (!state.cmd) {
	// 	state.cmd = state.contexts[0]?.commands?.default;
	// }

	// await applyDefaults(state);
	// await fillArgv(state);

	// if (state.required.size) {
	// 	throw new Error(`Missing required options: ${Array.from(state.required).map(opt => opt.name).join(', ')}`);
	// }
	// delete state.required;

	// return results;
}

export default exec;
