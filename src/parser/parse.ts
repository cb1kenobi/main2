import debug from '../debug/index.js';
import { attachState, fireBeforeError } from '../error-hooks.js';
import {
	DataType,
	Internal,
	InternalCommand,
	InternalOption,
	ParsedBase,
	ParsedOption,
	ParsedUnknownOption,
	ParsedValue,
	ParseOptions,
	ParseState,
	Schema,
} from '../types.js';
import { camelCase } from '../util/camel-case.js';
import { transformValue } from '../util/transform.js';
import { initCommand } from './command/init-command.js';
import { loadCommand } from './command/load-command.js';

const { log } = debug('main2:parser');

const optionGroupRE = /^-(\w{2,})$/;
const optionLikeRE = /^--?\w/;
const optionNoSpaceRE = /^([^'"]*)(['"])(.*)\2$/;
const negatedRE = /^--no-/;
const unknownOptionRE = /^(?:--(\w[\w-]*)|-(\w))$/;

/**
 * Parses argv against a schema.
 *
 * Every throw site -- an invalid schema, a command module that will not load,
 * a missing required option, a bad data type, a hook or transform of the
 * caller's own -- leaves through the one catch below, which is where the
 * `beforeError` hooks fire and where the in-flight state is pinned to the
 * error. So a caller using `parse()` without `main2()` gets the same error
 * path.
 *
 * @param opts - The parse options.
 * @returns The resolved parse state.
 */
export async function parse(opts: ParseOptions = {}): Promise<ParseState> {
	let schema: Schema | undefined;
	let state: ParseState | undefined;

	try {
		if (opts !== undefined && (opts === null || typeof opts !== 'object')) {
			throw new TypeError('Expected parse options to be an object');
		}

		// the schema comes first because it is where the `beforeError` hooks
		// live: reading anything else off the options ahead of it would leave a
		// getter of the caller's own able to throw past its own hooks. Only an
		// absent schema gets the empty default; `null` is an error
		schema = opts.schema === undefined ? {} : opts.schema;

		const { argv, env = {} } = opts;

		if (!schema || typeof schema !== 'object') {
			throw new TypeError('Expected schema to be an object');
		}

		if (schema.name !== undefined && (!schema.name || typeof schema.name !== 'string')) {
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

		state = {
			$: [],
			$orig: argv || [],
			_: [],
			argv: {},
			cmd: undefined,
			// the root context is built from a copy of the schema, never by writing
			// a default name onto the caller's object
			contexts: [await initCommand({ ...schema, name: schema.name ?? 'global' })],
			env,
			schema,
			settings: opts.settings || {},
		};

		await initArgv(state);
		await parseArgv(state);
		await processArgs(state);
		await processOptions(state);

		return state;
	} catch (err) {
		attachState(err, state);
		// a hook may replace the error, never swallow it, so this always throws
		throw await fireBeforeError(err, state, schema);
	}
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
			orig: arg,
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
 * Decides whether a flag token turns its destination off.
 *
 * A negated flag turns it off through every name it answers to — `-C` as much
 * as `--no-color` — except the positive spelling it registers for itself,
 * which is the one way to turn it on. An explicit `negate: false` opts out of
 * negation entirely, so a flag literally named `no-color` is just present.
 *
 * @param option - The declared option the token resolved to.
 * @param subject - The token as it was typed.
 * @returns `true` when the token means off.
 */
function isNegated(option: InternalOption, subject?: string): boolean {
	if (option.negate === false) {
		return false;
	}
	if (option.negate) {
		return subject !== `--${option.name}`;
	}
	return negatedRE.test(`${subject}`);
}

/**
 * Decides whether the next unresolved token may be taken as the value of a
 * declared option.
 *
 * A token that resolves to a known option is left alone, so `--name --verbose`
 * does not silently swallow `--verbose`. Anything else is fair game, including
 * an option-like token that nothing declared, because values legitimately
 * start with a dash and `--name=--verbose` is the way to force the issue.
 *
 * @param contexts - The context chain, innermost first.
 * @param entry - The next entry in the token stream, if there is one.
 * @returns `true` when the entry can be consumed as a value.
 */
function canBeValue(contexts: InternalCommand[], entry?: ParsedValue): boolean {
	if (entry?.type !== 'Unknown') {
		return false;
	}

	const subject = entry.inputs[0];

	// the terminator belongs to the argv stream, never to an option
	if (subject === '--') {
		return false;
	}

	// a plain value is always fair game; only an option-like token has to prove
	// it is not a declared option first
	if (!subject || !optionLikeRE.test(subject)) {
		return true;
	}

	return !findOption(contexts, subject) && !expandGroup(contexts, entry);
}

/**
 * Reads a resolved value without letting `Object.prototype` answer for it.
 * A destination such as `toString` — from `--to-string` — would otherwise
 * always look defined, silently suppressing its default, its environment
 * fallback, and its required check.
 *
 * @param state - The parse state.
 * @param dest - The destination key in `state.argv`.
 * @returns The value actually parsed, or `undefined`.
 */
function resolved(state: ParseState, dest: string): unknown {
	return Object.hasOwn(state.argv, dest) ? state.argv[dest] : undefined;
}

/**
 * Reads the first environment variable of a list that is set.
 *
 * @param state - The parse state.
 * @param envs - Environment variable names to look for.
 * @returns The value of the first one that is defined, if any.
 */
function envValue(state: ParseState, envs: Set<string>): string | undefined {
	for (const env of envs) {
		if (state.env[env] !== undefined) {
			return state.env[env];
		}
	}
}

/**
 * Applies a fallback to a destination argv did not fill, coercing strings to
 * the declared data type exactly as a value parsed from argv would be.
 *
 * Precedence is argv, then environment, then default: callers apply every
 * environment fallback before any default, so that a declared default does not
 * make the variable unreachable — and so that a flag, which always has an
 * implicit default, can be set from the environment at all.
 *
 * @param state - The parse state.
 * @param dest - The destination key in `state.argv`.
 * @param value - The fallback value, if there is one.
 * @param type - The declared data type.
 * @param multiple - When set, scalar fallbacks are wrapped in an array.
 */
function applyFallback(
	state: ParseState,
	dest: string,
	value: unknown,
	type: DataType | string,
	multiple?: boolean
): void {
	if (value === undefined || resolved(state, dest) !== undefined) {
		return;
	}

	if (typeof value === 'string') {
		value = transformValue(value, type);
	} else if (Array.isArray(value)) {
		// an array `default` belongs to the caller; handing it straight to
		// `argv` would let a consumer's `push` reach back into the schema and
		// change what the next parse defaults to
		value = [...value];
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

/**
 * Takes the place of the command name that was never typed.
 *
 * A command marked `default` runs when argv did not name one, so the innermost
 * context is consulted for a default only once every context discovered so far
 * has had a pass -- by then argv is not going to name a command it has not
 * already named. The default joins the chain exactly as a matched command
 * does, which is the whole point: its options resolve on the pass that
 * follows, its arguments take the positional values, and `state.cmd` is the
 * command `main2()` runs. The one difference is that nothing is added to
 * `state.$`, because no token in argv named it.
 *
 * @param state - The parse state.
 * @param visited - The default commands already adopted, so that a schema that
 * points a command at itself cannot loop forever.
 * @returns `true` when a default command joined the chain.
 */
async function dispatchDefaultCommand(
	state: ParseState,
	visited: Set<InternalCommand>
): Promise<boolean> {
	const cmd = state.contexts[0][Internal].commands.default;

	if (!cmd || visited.has(cmd)) {
		return false;
	}
	visited.add(cmd);

	log(`Dispatching default command "${cmd.name}"`);

	// matched before loaded, same as a typed command: a module that will not
	// load is an error this command's own `beforeError` hooks should still see
	state.contexts.unshift(cmd);
	state.cmd = cmd;

	const loaded = await loadCommand(cmd);
	if (loaded !== cmd) {
		state.contexts[0] = loaded;
		state.cmd = loaded;
		visited.add(loaded);
	}

	if (loaded.hooks?.parse) {
		for (const hook of loaded.hooks.parse) {
			await hook({ cmd: loaded, ...loaded[Internal] });
		}
	}

	return true;
}

async function parseArgv(state: ParseState): Promise<void> {
	const { $, contexts } = state;
	const defaults = new Set<InternalCommand>();

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

				// the command has matched, so it joins the chain before the module
				// behind it is loaded -- a module that will not load is an error
				// this command's own `beforeError` hooks should still see
				contexts.unshift(cmd);
				state.cmd = cmd;

				const loaded = await loadCommand(cmd);
				if (loaded !== cmd) {
					// loading merged the module's exports into a new command object
					contexts[0] = loaded;
					state.cmd = loaded;
				}

				$[j] = {
					cmd: loaded,
					inputs: arg.inputs,
					type: 'Command',
				};

				if (loaded.hooks?.parse) {
					for (const hook of loaded.hooks.parse) {
						await hook({ cmd: loaded, ...loaded[Internal] });
					}
				}

				continue;
			}

			// options resolve against the whole chain so that a subcommand can
			// use its parents' options, but only option-like tokens get to look:
			// the registry also indexes bare names, so an unguarded lookup would
			// resolve the positional value `foo` as the option `--foo`
			const option = optionLikeRE.test(`${subject}`) ? findOption(contexts, subject) : undefined;

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
				value = isNegated(option, subject) ? !bool : bool;
			} else {
				const next = $[j + 1];

				if (inputs.length > 1) {
					value = inputs[1];
				} else if (next && canBeValue(contexts, next)) {
					value = next.orig ?? next.inputs[0];
					inputs.push(value as string);
					$.splice(j + 1, 1);
				} else {
					// the option was typed but nothing followed it that could be
					// its value, so the declared data type decides what nothing
					// means: '' for a string, 0 for a number, and so on
					value = '';
				}

				if (option.required && !value) {
					throw new Error(`Missing value for required option ${label}`);
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

		// this pass turned up no new context, so argv has named every command it
		// is going to: whatever the innermost context calls its default command
		// now stands in for the name that was never typed. Adopting it grows the
		// chain, so the loop makes one more pass and resolves the options it
		// declares -- and then asks it for a default of its own
		if (pass === contexts.length - 1) {
			await dispatchDefaultCommand(state, defaults);
		}
	}

	parseUnknownOptions(state);

	if (state.schema.hooks?.afterParse) {
		for (const hook of state.schema.hooks.afterParse) {
			await hook(state);
		}
	}
}

/**
 * Resolves every option-like token that no context declared. This runs after
 * the context passes so that a token is only called unknown once every command
 * — and with it every option those commands declare — has been discovered.
 *
 * An undeclared option is not known to take a value, so it only takes one when
 * the next token could not be an option itself. That is the mirror image of a
 * declared option, which is known to want a value and so takes whatever
 * follows.
 *
 * @param state - The parse state.
 */
function parseUnknownOptions(state: ParseState): void {
	const { $ } = state;
	const allowed = state.settings?.allowUnknownOptions !== false;

	for (let j = 0; j < $.length; j++) {
		const arg = $[j];

		if (arg.type !== 'Unknown') {
			continue;
		}

		const subject = arg.inputs[0];
		const m = subject?.match(unknownOptionRE);
		if (!m) {
			continue;
		}

		if (!allowed) {
			throw new Error(`Unknown option "${subject}"`);
		}

		log(`Found unknown option "${subject}"`);

		const { inputs } = arg;
		let value: unknown = true;

		if (inputs.length > 1) {
			value = inputs[1];
		} else {
			const next = j + 1 < $.length ? $[j + 1] : undefined;
			const following = next?.inputs[0];
			if (next?.type === 'Unknown' && following !== '--' && !optionLikeRE.test(`${following}`)) {
				value = next.orig ?? following;
				inputs.push(value as string);
				$.splice(j + 1, 1);
			}
		}

		if (typeof value === 'string') {
			// nothing declared a data type for this, so guess at one
			value = transformValue(value, 'auto');
		}

		$[j] = {
			dest: camelCase(m[1] ?? m[2]),
			inputs,
			orig: arg.orig,
			type: 'UnknownOption',
			value,
		};
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
				throw new Error(`Unexpected argument "${inputs[0]}"`);
			}

			if (arg) {
				const { multiple, type } = arg;
				const { dest } = arg[Internal];
				if (multiple) {
					// gobble every remaining positional value, but with its own
					// index: advancing `i` here would run the outer loop off the
					// end and silently drop every option that follows
					for (let k = i + 1; k < state.$.length; k++) {
						const next: ParsedBase = state.$[k];
						if (next.type === 'Unknown') {
							inputs.push(...next.inputs);
							state.$.splice(k--, 1);
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
				const count = resolved(state, dest);
				state.argv[dest] = typeof count !== 'number' ? 1 : count + 1;
			} else if (option.multiple) {
				if (Array.isArray(resolved(state, dest))) {
					(state.argv[dest] as unknown[]).push(value);
				} else {
					state.argv[dest] = [value];
				}
			} else {
				state.argv[dest] = value;
			}
		} else if (parsedType === 'UnknownOption') {
			const { dest, value } = parsed as ParsedUnknownOption;
			state.argv[dest] = value;
		}
	}

	// detect missing required args while populating optional args
	const missingArguments: string[] = [];

	for (let i = internal.args.length - 1; i >= argIdx; i--) {
		const arg = internal.args[i];
		const { name, required } = arg;

		const { dest, envs } = arg[Internal];

		applyFallback(state, dest, envValue(state, envs) ?? arg.default, arg.type, arg.multiple);

		if (missingArguments.length || (required && resolved(state, dest) === undefined)) {
			missingArguments.unshift(`<${name}>`);
		}
	}

	if (missingArguments.length) {
		throw new Error(`Missing required arguments: ${missingArguments.join(' ')}`);
	}

	for (const arg of internal.args) {
		assertChoices(arg.choices, resolved(state, arg[Internal].dest), `argument <${arg.name}>`);
	}
}

export async function processOptions(state: ParseState): Promise<void> {
	const missingOptions: string[] = [];
	const all = state.contexts.flatMap((ctx) => [...ctx[Internal].options.values()]);

	// every environment fallback is applied before any default, and both before
	// anything is validated, so that a destination two options share — a valued
	// option and its negated twin — keeps the same argv, then environment, then
	// default precedence a lone option has, and is not reported missing just
	// because the option that fills it comes second
	for (const opt of all) {
		const { dest, envs } = opt[Internal];
		applyFallback(state, dest, envValue(state, envs), opt.type, opt.multiple);
	}

	for (const opt of all) {
		const { dest, skipDefault } = opt[Internal];

		// the valued twin owns the default of the destination the two share
		if (!skipDefault) {
			applyFallback(state, dest, opt.default, opt.type, opt.multiple);
		}
	}

	for (const opt of all) {
		const { choices, required } = opt;
		const { dest, label, negatedTwin } = opt[Internal];
		const value = resolved(state, dest);
		const typed = state.$.some((parsed) => parsed.type === 'Option' && parsed.option === opt);

		if (required && !typed && value === undefined) {
			missingOptions.unshift(label);
		}

		// only validate when there is actually a value to validate, and never
		// against a `false` this option did not produce: turning the destination
		// off is what the negated twin means, not one of the values declared here
		if (!negatedTwin || typed || value !== false) {
			assertChoices(choices, value, `option ${label}`);
		}
	}

	if (missingOptions.length) {
		throw new Error(`Missing required options: ${missingOptions.join(' ')}`);
	}
}
