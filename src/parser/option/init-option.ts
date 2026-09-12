import { Internal, InternalOption, InternalState, Option } from '../../types.js';
import { camelCase } from '../../util/camel-case.js';
import { copyDeclaration } from '../../util/copy-declaration.js';

/**
 * "all"
 * "-a"
 * "-a, --all"
 * "-a --all"
 * "-p, --path <hint>"
 * "--opt <value>"
 * "--opt [value]"
 */

const optionAliasSplitRE = /[ ,|]+/;
const optionHintRE = /^(\[(?=.+\]$)|<(?=.+>$))(.+?)[\]>]$/;
const optionLongLikeRE = /^--(.*)$/;
export const optionLongRE: RegExp = /^--(\w[\w-]*)$/;
const optionLongMaybeDashesRE = /^(?:--)?(\w[\w-]*)$/;
const optionNameRE = /^\w[\w-]*$/;
const optionNegateRE = /^no-(\w[\w-]*)$/;
const optionShortRE = /^-\w$/;
const optionSplitRE = /[ ,|=]+/;
const optionTypesRE = /^auto|bool|count|date|int|json|number|string|yesno$/;

/**
 * Builds an internal option from a declaration. Everything the format string
 * implies — the name, hint, requiredness, negation, data type, and default —
 * is written to a new object this library owns, never back onto the caller's
 * declaration, so the same declaration always parses the same way.
 *
 * @param it - The option declaration, or an already initialized option.
 * @returns A new internal option.
 */
export async function initOption(it: Option | InternalOption): Promise<InternalOption> {
	if (typeof it === 'object' && Internal in it && it[Internal].state === InternalState.OK) {
		return it as InternalOption;
	}

	// copy the declaration instead of decorating it so the caller's object is
	// never written to
	const opt: Option = copyDeclaration(it);

	const long = new Set<string>();
	const short = new Set<string>();
	let isFlag = !opt.hint && !Array.isArray(opt.choices);

	if (opt.format !== undefined) {
		const parts =
			opt.format && typeof opt.format === 'string' && new Set(opt.format.split(optionSplitRE));
		if (!parts) {
			throw new TypeError('Expected option format to be a non-empty string');
		}

		for (const p of parts) {
			let m = p.match(optionLongLikeRE);
			if (m) {
				m = p.match(optionLongRE);
				if (!m) {
					throw new TypeError(`Invalid option format: ${p}`);
				}
				long.add(p);
				opt.name ??= m[1];
				continue;
			}

			m = p.match(optionShortRE);
			if (m) {
				short.add(m[0]);
			} else {
				m = p.match(optionHintRE);
				if (m) {
					// we have an option, not a flag
					opt.hint ??= m[2];
					isFlag = false;
					if (m[1] === '<') {
						opt.required ??= true;
					}
				} else if (!optionNameRE.test(p)) {
					// not a long name, a short name, or a hint, so the only thing
					// left it can be is a bare name; anything else is malformed
					// and would otherwise become an untypable option
					throw new TypeError(`Invalid option format: ${p}`);
				} else if (!opt.name) {
					opt.name = p;
					long.add(`--${opt.negate ? 'no-' : ''}${opt.name}`);
				}
			}
		}

		opt.name ??= short[Symbol.iterator]().next().value?.slice(1);
	} else if (opt.name) {
		long.add(`--${opt.name}`);
	}

	if (!opt.name) {
		throw new TypeError('Expected option name to be a non-empty string');
	}

	if (opt.type && !optionTypesRE.test(opt.type)) {
		throw new Error(`Option "${opt.name}" has unsupported data type "${opt.type}"`);
	}

	// parse negate
	const m = opt.name.match(optionNegateRE);
	if (m && isFlag && opt.negate !== false) {
		opt.negate = true;
		opt.name = m[1];
		long.add(`--${opt.name}`); // add non-negated value
	}

	opt.type ||= isFlag ? 'bool' : 'string';
	if (isFlag) {
		if (opt.type === 'auto' || opt.type === 'yesno') {
			opt.type = 'bool';
		} else if (opt.type !== 'bool' && opt.type !== 'count') {
			throw new Error("Option flags must have type of 'auto', 'bool', 'count', or 'yesno'");
		}
		opt.default ??= opt.type === 'count' ? 0 : !!opt.negate;
	} else if (opt.type === 'count') {
		throw new Error('Only flags can be of type "count"');
	}

	if (opt.alias !== undefined) {
		let aliases;
		if (typeof opt.alias === 'string') {
			aliases = new Set(opt.alias.split(optionAliasSplitRE));
		} else if (Array.isArray(opt.alias)) {
			aliases = new Set(
				opt.alias.flatMap((a) => {
					if (typeof a !== 'string') {
						throw new TypeError('Expected option alias to be a string or list of strings');
					}
					return a.split(optionAliasSplitRE);
				})
			);
		} else {
			throw new TypeError('Expected option alias to be a string or list of strings');
		}

		for (const alias of aliases) {
			let m = alias.match(optionShortRE);
			if (m) {
				short.add(m[0]);
				continue;
			}

			m = alias.match(optionLongMaybeDashesRE);
			if (m) {
				long.add(`--${m[1]}`);
				continue;
			}

			throw new TypeError(`Invalid option alias "${alias}"`);
		}
	}

	const envs = new Set<string>();
	if (opt.env !== undefined) {
		const env = typeof opt.env === 'string' ? [opt.env] : opt.env;

		if (!Array.isArray(env)) {
			throw new TypeError(
				'Expected option environment variable to be a string or array of strings'
			);
		}

		for (const e of env) {
			if (e && typeof e === 'string') {
				envs.add(e);
			}
		}
	}

	if (opt.choices !== undefined) {
		if (!Array.isArray(opt.choices)) {
			throw new TypeError('Expected option choices to be an array');
		}
		opt.hint ??= 'value';
	}

	if (opt.transform && typeof opt.transform !== 'function') {
		throw new TypeError('Expected option transform function to be a function');
	}

	const label = long[Symbol.iterator]().next().value || short[Symbol.iterator]().next().value;

	return new Proxy(
		Object.defineProperty(opt, Internal, {
			configurable: true,
			value: {
				dest: camelCase(opt.name),
				envs,
				isFlag,
				label,
				format: label + (isFlag ? '' : opt.required ? `=<${opt.hint}>` : `=[${opt.hint}]`),
				long,
				short,
				state: InternalState.OK,
			},
		}),
		{
			// TODO: wrap set/delete to detect changes
		}
	) as InternalOption;
}
