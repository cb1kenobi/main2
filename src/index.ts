import { parse } from './parser/index.js';
import {
	AppOptions,
	ParseState,
	Schema
} from './types.js';

export * from './types.js';

export default function init(opts) {
	const app = new App(opts);
	return app.exec.bind(app);
}

export class App {
	schema: Schema;

	constructor(opts: AppOptions) {
		this.schema = opts.schema;
	}

	async exec(argv: string[] | undefined): Promise<ParseState> {
		const results = await parse({
			argv:   argv || process.argv.slice(2),
			env:    process.env,
			schema: this.schema
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

		return results;
	}
}
