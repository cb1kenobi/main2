import { Internal, InternalOption, InternalState, Option } from '../../types.js';
import { camelCase } from '../../util/camel-case.js';

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

export async function initOption(it: Option | InternalOption): Promise<InternalOption> {
	if (typeof it === 'object' && Internal in it && it[Internal].state === InternalState.OK) {
		return it as InternalOption;
	}

	const long = new Set<string>();
	const short = new Set<string>();
	let isFlag = !it.hint && !Array.isArray(it.choices);

	if (it.format !== undefined) {
		const parts =
			it.format && typeof it.format === 'string' && new Set(it.format.split(optionSplitRE));
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
				it.name ??= m[1];
				continue;
			}

			m = p.match(optionShortRE);
			if (m) {
				short.add(m[0]);
			} else {
				m = p.match(optionHintRE);
				if (m) {
					// we have an option, not a flag
					it.hint ??= m[2];
					isFlag = false;
					if (m[1] === '<') {
						it.required ??= true;
					}
				} else if (!optionNameRE.test(p)) {
					// not a long name, a short name, or a hint, so the only thing
					// left it can be is a bare name; anything else is malformed
					// and would otherwise become an untypable option
					throw new TypeError(`Invalid option format: ${p}`);
				} else if (!it.name) {
					it.name = p;
					long.add(`--${it.negate ? 'no-' : ''}${it.name}`);
				}
			}
		}

		it.name ??= short[Symbol.iterator]().next().value?.slice(1);
	} else if (it.name) {
		long.add(`--${it.name}`);
	}

	if (!it.name) {
		throw new TypeError('Expected option name to be a non-empty string');
	}

	if (it.hint?.endsWith('...')) {
		// a variadic hint promises `--tag a b c`, which an option never does;
		// only a positional argument can consume consecutive values
		throw new TypeError(
			`Option "${it.name}" hint cannot be variadic; use \`multiple: true\` to collect repeated uses into an array`
		);
	}

	if (it.type && !optionTypesRE.test(it.type)) {
		throw new Error(`Option "${it.name}" has unsupported data type "${it.type}"`);
	}

	// parse negate
	const m = it.name.match(optionNegateRE);
	if (m && isFlag && it.negate !== false) {
		it.negate = true;
		it.name = m[1];
		long.add(`--${it.name}`); // add non-negated value
	}

	it.type ||= isFlag ? 'bool' : 'string';

	// a default the parser supplied is weaker than one the schema declared: it
	// gives way to the twin that shares its destination, if there is one
	let impliedDefault = false;

	if (isFlag) {
		if (it.type === 'auto' || it.type === 'yesno') {
			it.type = 'bool';
		} else if (it.type !== 'bool' && it.type !== 'count') {
			throw new Error("Option flags must have type of 'auto', 'bool', 'count', or 'yesno'");
		}
		if (it.default === undefined) {
			it.default = it.type === 'count' ? 0 : !!it.negate;
			impliedDefault = true;
		}
	} else if (it.type === 'count') {
		throw new Error('Only flags can be of type "count"');
	}

	if (it.alias !== undefined) {
		let aliases;
		if (typeof it.alias === 'string') {
			aliases = new Set(it.alias.split(optionAliasSplitRE));
		} else if (Array.isArray(it.alias)) {
			aliases = new Set(
				it.alias.flatMap((a) => {
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

	const envs = new Set();
	if (it.env !== undefined) {
		const env = typeof it.env === 'string' ? [it.env] : it.env;

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

	if (it.choices !== undefined) {
		if (!Array.isArray(it.choices)) {
			throw new TypeError('Expected option choices to be an array');
		}
		it.hint ??= 'value';
	}

	if (it.transform && typeof it.transform !== 'function') {
		throw new TypeError('Expected option transform function to be a function');
	}

	const label = long[Symbol.iterator]().next().value || short[Symbol.iterator]().next().value;

	return new Proxy(
		Object.defineProperty(it, Internal, {
			configurable: true,
			value: {
				dest: camelCase(it.name),
				envs,
				impliedDefault,
				isFlag,
				label,
				format: label + (isFlag ? '' : it.required ? `=<${it.hint}>` : `=[${it.hint}]`),
				long,
				short,
				skipDefault: false,
			},
		}),
		{
			// TODO: wrap set/delete to detect changes
		}
	) as InternalOption;
}
