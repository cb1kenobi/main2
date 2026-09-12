import debug from '../debug/index.js';
import {
	DataType,
	Internal,
	InternalCommand,
	InternalOption,
	ParsedBase,
	ParsedOption,
	ParsedValue,
	ParseOptions,
	ParseState,
} from '../types.js';
import { transformValue } from '../util/transform.js';
import { initCommand } from './command/init-command.js';
import { loadCommand } from './command/load-command.js';
import { optionLongRE } from './option/init-option.js';

const { log } = debug('main2:parser');

const optionGroupRE = /^-(\w{2,})$/;
const optionLikeRE = /^--?\w/;
const optionNoSpaceRE = /^([^'"]*)(['"])(.*)\2$/;
const negatedRE = /^--no-/;

export async function parse(opts: ParseOptions = {}): Promise<ParseState> {
	if (opts !== undefined && (opts === null || typeof opts !== 'object')) {
		throw new TypeError('Expected parse options to be an object');
	}

	const { argv, env = {}, schema = {} } = opts;

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
		...schema.hooks,
	};
	for (const [name, hookList] of Object.entries(hooks)) {
		if (!Array.isArray(hookList) || hookList.some((h) => typeof h !== 'function')) {
			throw new TypeError(`Expected "${name}" hook to be an array of functions`);
		}
	}

	if (argv !== undefined && !Array.isArray(argv)) {
		throw new TypeError('Expected argv to be an array');
	}

	if (!env || typeof env !== 'object') {
		throw new TypeError('Expected environment option to be an object');
	}

	const state: ParseState = {
		$: [],
		$orig: argv || [],
		_: [],
		argv: {},
		cmd: undefined,
		contexts: [await initCommand(schema)],
		env,
		schema,
		settings: opts.settings || {},
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
	log(
		`Processing ${argv.length} argument${argv.length === 1 ? '' : 's'}${argv.length ? `: ${argv.join(', ')}` : ''}`
	);

	for (let arg of argv) {
		const inputs = [arg];

		if (optionLikeRE.test(arg)) {
			// check if we have --option=value
			const p = arg.indexOf('=');
			if (p > 0) {
				inputs[0] = arg.slice(0, p).trim();
				inputs.push(arg.slice(p + 1).trim());
			} else {
				// check if we have --option"value"
				const m = arg.match(optionNoSpaceRE);
				if (m) {
					inputs[0] = m[1];
					inputs.push(m[3]);
				}
			}
		}

		state.$.push({
			inputs,
			type: 'Unknown',
		});
	}
}

/**
 * Finds an option by name across the entire context chain, innermost context
 * first, so that a subcommand can use the options its parents declared.
 *
 * @param contexts - The context chain, innermost first.
 * @param name - The option name to look for.
 * @returns The option, if any context declares it.
 */
function findOption(contexts: InternalCommand[], name?: string): InternalOption | undefined {
	for (const ctx of contexts) {
		const option = ctx[Internal].options.find(name);
		if (option) {
			return option;
		}
	}
}

/**
 * Expands a short option group such as `-abc` or `-n5`. This cannot happen
 * until the schema is known: whether the `5` in `-n5` is a value or another
 * flag depends entirely on how `-n` was declared.
 *
 * @param contexts - The context chain, innermost first.
 * @param entry - The unresolved argument to expand.
 * @returns The expanded entries, or `undefined` if the group did not resolve.
 */
function expandGroup(contexts: InternalCommand[], entry: ParsedBase): ParsedValue[] | undefined {
	const m = entry.inputs[0]?.match(optionGroupRE);
	if (!m) {
		return;
	}

	const chars = m[1];
	const explicit = entry.inputs[1];
	const expanded: ParsedValue[] = [];

	for (let i = 0; i < chars.length; i++) {
		const name = `-${chars[i]}`;
		const option = findOption(contexts, name);

		if (!option) {
			// nothing resolved at all, leave the token for a later context pass
			if (i === 0) {
				return;
			}

			// partially resolved, so defer whatever is left
			const rest: (string | undefined)[] = [`-${chars.slice(i)}`];
			if (explicit !== undefined) {
				rest.push(explicit);
			}
			expanded.push({ inputs: rest, type: 'Unknown' });
			return expanded;
		}

		if (option[Internal].isFlag) {
			expanded.push({ inputs: [name], type: 'Unknown' });
			continue;
		}

		// this option takes a value, so the rest of the group is that value
		const rest = chars.slice(i + 1);
		const inputs: (string | undefined)[] = [name];
		if (rest) {
			inputs.push(rest);
		} else if (explicit !== undefined) {
			inputs.push(explicit);
		}
		expanded.push({ inputs, type: 'Unknown' });
		return expanded;
	}

	// every character was a flag, so an explicit value belongs to the last one
	if (explicit !== undefined && expanded.length) {
		expanded[expanded.length - 1].inputs.push(explicit);
	}

	return expanded;
}

/**
 * Applies a default value or environment variable fallback, coercing strings
 * to the declared data type exactly as a value parsed from argv would be.
 *
 * @param state - The parse state.
 * @param dest - The destination key in `state.argv`.
 * @param def - The declared default value, if any.
 * @param envs - Environment variable names to fall back to.
 * @param type - The declared data type.
 * @param multiple - When set, scalar fallbacks are wrapped in an array.
 */
function applyFallback(
	state: ParseState,
	dest: string,
	def: unknown,
	envs: Set<string>,
	type: DataType | string,
	multiple?: boolean
): void {
	if (state.argv[dest] !== undefined) {
		return;
	}

	let value = def;

	if (value === undefined) {
		for (const env of envs) {
			if (state.env[env] !== undefined) {
				value = state.env[env];
				break;
			}
		}
	}

	if (value === undefined) {
		return;
	}

	if (typeof value === 'string') {
		value = transformValue(value, type);
	}

	state.argv[dest] = multiple && !Array.isArray(value) ? [value] : value;
}

/**
 * Validates a value against a list of allowed choices.
 *
 * @param choices - The allowed values, if the definition declared any.
 * @param value - The resolved value.
 * @param label - The option or argument label used in the error message.
 */
function assertChoices(choices: unknown[] | undefined, value: unknown, label: string): void {
	if (!Array.isArray(choices) || value === undefined) {
		return;
	}

	for (const v of Array.isArray(value) ? value : [value]) {
		if (!choices.includes(v)) {
			throw new Error(`Invalid value "${v}" for ${label}`);
		}
	}
}

async function parseArgv(state: ParseState): Promise<void> {
	const { $, contexts } = state;

	if (state.schema.hooks?.beforeParse) {
		for (const hook of state.schema.hooks.beforeParse) {
			await hook(state);
		}
	}

	// Options may appear before the command that declares them, so keep making
	// passes for as long as new command contexts keep turning up.
	for (let pass = 0; pass < contexts.length; pass++) {
		log(`Parsing argv with context "${contexts[0].name}"`);

		for (let j = 0; j < $.length; j++) {
			const arg = $[j];

			if (arg.type !== 'Unknown') {
				continue;
			}

			const subject = arg.inputs[0];

			if (subject === '--') {
				$[j] = {
					inputs: $.splice(j, $.length)
						.slice(1)
						.flatMap((a) => a.inputs),
					type: 'Extra',
				};
				break;
			}

			// commands only resolve against the innermost context, otherwise a
			// token repeating a command name would match a second time
			const cmd = contexts[0][Internal].commands.find(subject);
			if (cmd) {
				log(`Found command "${cmd.name}"`);
				const loaded = await loadCommand(cmd);
				$[j] = {
					cmd: loaded,
					inputs: arg.inputs,
					type: 'Command',
				};
				contexts.unshift(loaded);
				state.cmd = loaded;

				if (loaded.hooks?.parse) {
					for (const hook of loaded.hooks.parse) {
						await hook({ cmd: loaded, ...loaded[Internal] });
					}
				}

				continue;
			}

			// options resolve against the whole chain so that a subcommand can
			// use its parents' options
			const option = findOption(contexts, subject);

			if (!option) {
				const expanded = expandGroup(contexts, arg);
				if (expanded) {
					// reprocess starting at the first expanded entry
					$.splice(j--, 1, ...expanded);
				}
				continue;
			}

			const { inputs } = arg;
			const { type } = option;
			const { isFlag, label } = option[Internal];
			let value: unknown;

			log(`Found ${label}`);

			if (isFlag) {
				// `--foo` is true and `--no-foo` is false, but an explicit
				// `--foo=false` beats the name it was reached by
				const bool = inputs.length > 1 ? transformValue(`${inputs[1]}`, 'bool') : true;
				value = negatedRE.test(`${subject}`) ? !bool : bool;
			} else if (inputs.length > 1) {
				value = inputs[1];
			} else {
				const next = j + 1 < $.length ? $[j + 1] : undefined;
				if (next?.type === 'Unknown') {
					value = next.inputs[0];
					inputs.push(value as string);
					$.splice(j + 1, 1);
				}
			}

			if (typeof option.transform === 'function') {
				const result = await option.transform(value, state);
				if (result !== undefined) {
					value = result;
				}
			}

			if (typeof value === 'string') {
				value = transformValue(value, type);
			}

			$[j] = {
				inputs,
				option,
				type: 'Option',
				value,
			};
		}
	}

	if (state.schema.hooks?.afterParse) {
		for (const hook of state.schema.hooks.afterParse) {
			await hook(state);
		}
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
	const ctx = state.contexts[0];
	const internal = ctx[Internal];

	let argIdx = 0;

	// loop through all parsed args and populate argv
	for (let i = 0; i < state.$.length; i++) {
		const parsed: ParsedBase = state.$[i];
		const parsedType = parsed.type;
		let inputs: unknown[] = parsed.inputs;

		if (parsedType === 'Unknown') {
			const arg = internal.args[argIdx++];

			if (!state.settings?.allowUnexpectedArguments && !arg) {
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
						if (parsed.type === 'Unknown') {
							inputs.push(...parsed.inputs);
							state.$.splice(i--, 1);
						}
					}
				}

				if (typeof arg.transform === 'function') {
					const result = await arg.transform(multiple ? inputs : inputs[0], state);
					if (result !== undefined) {
						inputs = multiple && Array.isArray(result) ? result : [result];
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
		} else if (parsedType === 'Extra') {
			if (state.settings?.allowExtraArguments) {
				state._.push(...inputs);
			} else {
				throw new Error(`Extra arguments are not allowed: ${inputs.join(' ')}`);
			}
		} else if (parsedType === 'Option') {
			const { option, value } = parsed as ParsedOption;
			const { dest, isFlag } = option[Internal];

			if (isFlag && option.type === 'count') {
				state.argv[dest] =
					typeof state.argv[dest] !== 'number' ? 1 : (state.argv[dest] as number) + 1;
			} else if (option.multiple) {
				if (Array.isArray(state.argv[dest])) {
					(state.argv[dest] as unknown[]).push(value);
				} else {
					state.argv[dest] = [value];
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

		applyFallback(state, dest, arg.default, envs, arg.type, arg.multiple);

		if (missingArguments.length || (required && state.argv[dest] === undefined)) {
			missingArguments.unshift(`<${name}>`);
		}
	}

	if (missingArguments.length) {
		throw new Error(`Missing required arguments: ${missingArguments.join(' ')}`);
	}

	for (const arg of internal.args) {
		assertChoices(arg.choices, state.argv[arg[Internal].dest], `argument <${arg.name}>`);
	}
}

export async function processOptions(state: ParseState): Promise<void> {
	const missingOptions: string[] = [];

	for (const ctx of state.contexts) {
		const { options } = ctx[Internal];

		for (const opt of options.values()) {
			const { choices, multiple, required, type } = opt;
			const { dest, envs, label } = opt[Internal];

			applyFallback(state, dest, opt.default, envs, type, multiple);

			if (required) {
				const existing = state.$.find(
					(parsed) => parsed.type === 'Option' && parsed.option === opt
				);
				if (!existing && state.argv[dest] === undefined) {
					missingOptions.unshift(label);
				}
			}

			// only validate when there is actually a value to validate
			assertChoices(choices, state.argv[dest], `option ${label}`);
		}
	}

	if (missingOptions.length) {
		throw new Error(`Missing required options: ${missingOptions.join(' ')}`);
	}
}
