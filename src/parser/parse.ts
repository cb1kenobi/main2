import debug from '../debug/index.js';
import initCommand from './command/init-command.js';
// import { inspect } from 'node:util';
import {
	Internal,
	ParsedBase,
	ParsedOption,
	ParsedType,
	ParseOptions,
	ParseState
} from '../types.js';
import loadCommand from './command/load-command.js';
import { optionLongRE } from './option/init-option.js';
import { transformValue } from '../util/transform.js';

const { log } = debug('main2:parser');

const optionGroupRegExp = /^-(\w+)$/;
const optionLikeRegExp = /^--?\w/;

export async function parse(opts: ParseOptions = {}): Promise<ParseState> {
	if (opts !== undefined && (opts === null || typeof opts !== 'object')) {
		throw new TypeError('Expected parse options to be an object');
	}

	const {
		argv,
		env = {},
		schema = {}
	} = opts;

	if (!schema || typeof schema !== 'object') {
		throw new TypeError('Expected schema to be an object');
	}

	if (schema.name === undefined) {
		schema.name = 'global';
	} else if (!schema.name || typeof schema.name !== 'string') {
		throw new TypeError('Expected schema name to be a non-empty string');
	}

	if (schema.hooks && typeof schema.hooks !== 'object') {
		throw new TypeError('Expected hooks to be an object of hook names and callbacks');
	}
	const hooks = {
		beforeParse: [],
		afterParse: [],
		beforeError: [],
		...schema.hooks
	};
	for (const [ name, hookList ] of Object.entries(hooks)) {
		if (!Array.isArray(hookList) || hookList.some(h => typeof h !== 'function')) {
			throw new TypeError(`Expected "${name}" hook to be an array of functions`);
		}
	}

	if (argv !== undefined && !Array.isArray(argv)) {
		throw new TypeError('Expected argv to be an array');
	}

	if (!env || typeof env !== 'object') {
		throw new TypeError('Expected environment option to be an object');
	}

	const state = {
		$: [],
		$orig: argv || [],
		_: [],
		argv: {},
		cmd: undefined,
		contexts: [
			await initCommand(schema)
		],
		env,
		hooks,
		schema
	};

	await initArgv(state);
	await parseArgv(state);
	await processArgs(state);
	await processOptions(state);

	return state;
}

export default parse;

async function initArgv(state: ParseState): Promise<void> {
	const argv = state.$orig;
	log(`Processing ${argv.length} argument${argv.length === 1 ? '' : 's'}${argv.length ? `: ${argv.join(', ')}` : ''}`);

	for (let arg of argv) {
		if (optionLikeRegExp.test(arg)) {
			const p = arg.indexOf('=');
			let value;
			if (p > 0) {
				value = arg.slice(p + 1).trim();
				arg = arg.slice(0, p).trim();
			}

			const m = arg.match(optionGroupRegExp);
			if (m) {
				const chars = m[1].split('');
				for (let i = 0, len = chars.length; i < len; i++) {
					const inputs = [ `-${chars[i]}` ];
					if (i + 1 === len && value !== undefined) {
						inputs.push(value);
					}
					state.$.push({
						inputs,
						type: ParsedType.Unknown
					});
				}
			} else {
				const inputs = [ arg ];
				if (value !== undefined) {
					inputs.push(value);
				}
				state.$.push({
					inputs,
					type: ParsedType.Unknown
				});
			}
		} else {
			state.$.push({
				inputs: [ arg ],
				type: ParsedType.Unknown
			});
		}
	}
}

async function parseArgv(state: ParseState): Promise<void> {
	const { $, contexts } = state;
	let ctx = contexts[0];

	for (const hook of state.hooks.beforeParse) {
		await hook(state);
	}

	// loop over contexts and identify commands and options
	for (let i = 0; i < contexts.length; i++) {
		const internal = ctx[Internal];

		log(`Parsing argv with context "${ctx.name}"`);

		for (let j = 0; j < $.length; j++) {
			const arg = $[j];

			if (arg.type !== ParsedType.Unknown) {
				continue;
			}

			const subject = arg.inputs[0];

			if (subject === '--') {
				$[j] = {
					inputs: $.splice(j, $.length).slice(1).flatMap(a => a.inputs),
					type: ParsedType.Extra
				};
				break;
			}

			// check if arg is a command
			const cmd = internal.commands.find(subject);
			if (cmd) {
				log(`Found command "${cmd.name}"`);
				ctx = await loadCommand(cmd);
				$[j] = {
					cmd: ctx,
					inputs: arg.inputs,
					type: ParsedType.Command
				};
				contexts.unshift(ctx);
				state.cmd = ctx;
				continue;
			}

			const option = internal.options.find(subject);
			if (option) {
				const { inputs } = arg;
				const { type } = option;
				const { isFlag, label } = option[Internal];
				let value;

				log(`Found ${label}`);

				if (isFlag) {
					value = !option.negate;
				} else if (inputs.length > 1) {
					value = inputs[1];
				} else {
					const next = j + 1 < $.length ? $[j + 1] : undefined;
					if (next?.type === ParsedType.Unknown) {
						value = next.inputs[0];
						inputs.push(value);
						$.splice(j + 1, 1);
					}
				}

				if (typeof option.transform === 'function') {
					const result = await option.transform(value, state);
					if (result !== undefined) {
						value = result;
					}
				}

				for (let i = 0, len = inputs.length; i < len; i++) {
					if (typeof value === 'string') {
						value = transformValue(value as string, type);
					}
				}

				$[j] = {
					inputs,
					option,
					type: ParsedType.Option,
					value
				};
			}
		}
	}

	for (const hook of state.hooks.afterParse) {
		await hook(state);
	}
}

/**
 * Populates the resulting parsed argument values from all unknown and extra
 * arguments while setting defaults, resolving environment variables, and
 * transforming values.
 *
 * @param state - The parse state.
 */
export async function processArgs(state: ParseState): Promise<void> {
	// log('Applying arguments:', inspect(state.$, { colors: true, depth: null, showHidden: true }));
	const ctx = state.contexts[0];
	const internal = ctx[Internal];
	const { schema } = state;

	let argIdx = 0;

	// loop through all parsed args and populate argv
	for (let i = 0; i < state.$.length; i++) {
		const parsed: ParsedBase = state.$[i];
		const parsedType = parsed.type;
		let { inputs } = parsed;

		if (parsedType === ParsedType.Unknown) {
			const arg = internal.args[argIdx++];

			if (!schema.settings?.allowUnexpectedArguments && !arg) {
				throw new Error(
					optionLongRE.test(`${inputs[0]}`)
						? `Unknown option "${inputs[0]}"`
						: `Unexpected argument "${inputs[0]}"`
				);
			}

			if (arg) {
				const { multiple, type } = arg;
				const { dest } = arg[Internal];
				if (multiple) {
					for (i++; i < state.$.length; i++) {
						const parsed: ParsedBase = state.$[i];
						if (parsed.type === ParsedType.Unknown) {
							inputs.push(...parsed.inputs);
							state.$.splice(i--, 1);
						}
					}
				}

				if (typeof arg.transform === 'function') {
					const result = await arg.transform(multiple ? inputs : inputs[0], state);
					if (result !== undefined) {
						inputs = multiple && Array.isArray(result) ? result : [ result ];
					}
				}

				for (let i = 0, len = inputs.length; i < len; i++) {
					if (typeof inputs[i] === 'string') {
						inputs[i] = transformValue(inputs[i] as string, type);
					}
				}

				state.argv[dest] = multiple || !Array.isArray(inputs) ? inputs : inputs[0];
			}

			state._.push(...inputs);

		} else if (parsedType === ParsedType.Extra) {
			if (schema.settings?.allowExtraArguments) {
				state._.push(...inputs);
			} else {
				throw new Error(`Extra arguments are not allowed: ${inputs.join(' ')}`);
			}

		} else if (parsedType === ParsedType.Option) {
			const { option, value } = parsed as ParsedOption;
			const { dest, isFlag } = option[Internal];

			if (isFlag && option.type === 'count') {
				state.argv[dest] = typeof state.argv[dest] !== 'number' ? 1 : ((state.argv[dest] as number) + 1);
			} else if (option.multiple) {
				if (Array.isArray(state.argv[dest])) {
					(state.argv[dest] as unknown[]).push(value);
				} else {
					state.argv[dest] = [ value ];
				}
			} else {
				state.argv[dest] = value;
			}
		}
	}

	// detect missing required args while populating optional args
	const missingArguments: string[] = [];

	for (let i = internal.args.length - 1; i >= argIdx; i--) {
		const arg = internal.args[i];
		const { name, required } = arg;

		const { dest, envs } = arg[Internal];
		if (arg.default !== undefined) {
			state.argv[dest] ??= arg.default;
		}
		for (const env of envs) {
			if (state.env[env] !== undefined) {
				state.argv[dest] ??= state.env[env];
				break;
			}
		}

		if (missingArguments.length || (required && state.argv[dest] === undefined)) {
			missingArguments.unshift(`<${name}>`);
		}
	}

	if (missingArguments.length) {
		throw new Error(`Missing required arguments: ${missingArguments.join(' ')}`);
	}
}

export async function processOptions(state: ParseState): Promise<void> {
	const missingOptions: string[] = [];

	for (const ctx of state.contexts) {
		const { options } = ctx[Internal];

		for (const opt of options.values()) {
			const { required } = opt;
			const { dest, envs } = opt[Internal];

			if (opt.default !== undefined) {
				state.argv[dest] ??= opt.default;
			}
			for (const env of envs) {
				if (state.env[env] !== undefined) {
					state.argv[dest] ??= state.env[env];
					break;
				}
			}

			if (required) {
				const existing = state.$.find(parsed => parsed.type === ParsedType.Option && parsed.option === opt);
				if (!existing && state.argv[dest] === undefined) {
					missingOptions.unshift(opt[Internal].label);
				}
			}
		}
	}

	if (missingOptions.length) {
		throw new Error(`Missing required options: ${missingOptions.join(' ')}`);
	}
}
