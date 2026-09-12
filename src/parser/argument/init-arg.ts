import { Argument, InternalState, Internal, InternalArgument } from '../../types.js';
import { camelCase } from '../../util/camel-case.js';

// foo         optional
// <foo>       required
// [foo]       optional
// foo...      optional, multiple
// <foo...>    required, multiple
// [foo...]    optional, multiple
// [foo]...    optional, multiple

const argRequiredRE = /^(?:<([\w-]+)(\.\.\.)?>|\[([\w-]+)(\.\.\.)?\]|([\w-]+?))\s*(\.\.\.)?$/;
const argTypesRE = /^auto|bool|date|int|json|number|string|yesno$/;

/**
 * Builds an internal argument from a declaration. The declaration is only ever
 * read: the normalized name, the `multiple` and `required` flags, the data
 * type, and the `Internal` state all land on a new object this library owns, so
 * the same declaration can be initialized again and see exactly what it saw the
 * first time.
 *
 * @param it - The argument declaration, or an already initialized argument.
 * @returns A new internal argument.
 */
export function initArg(it: string | Argument | InternalArgument): InternalArgument {
	if (it && typeof it === 'object' && Internal in it && it[Internal]?.state === InternalState.OK) {
		return it;
	}

	if (typeof it !== 'string' && (!it || typeof it !== 'object')) {
		throw new TypeError(`Invalid argument definition: ${it}`);
	}

	// copy the declaration instead of decorating it so the caller's object is
	// never written to
	const arg: Argument = typeof it === 'string' ? { name: it } : { ...it };

	let { name } = arg;

	if (!name || typeof name !== 'string') {
		if (typeof name === 'number') {
			name = String(name);
		} else {
			throw new Error('Expected argument to have a name');
		}
	}

	const m = name.match(argRequiredRE);
	if (!m) {
		throw new Error(`Invalid argument name: ${JSON.stringify(arg.name)}`);
	}

	const envs = new Set<string>();
	if (arg.env !== undefined) {
		const env = typeof arg.env === 'string' ? [arg.env] : arg.env;

		if (!Array.isArray(env)) {
			throw new TypeError(
				'Expected argument environment variable to be a string or array of strings'
			);
		}

		for (const e of env) {
			if (e && typeof e === 'string') {
				envs.add(e);
			}
		}
	}

	if (arg.type !== undefined && !argTypesRE.test(arg.type)) {
		throw new Error(`Argument "${arg.name}" has unsupported data type "${arg.type}"`);
	}

	if (arg.transform && typeof arg.transform !== 'function') {
		throw new TypeError('Expected argument transform function to be a function');
	}

	if (Array.isArray(arg.choices)) {
		// the same reasoning as an option: nothing that reaches this argument
		// later gets to append to the caller's own array
		arg.choices = [...arg.choices];
	}

	arg.multiple ||= !!(m[2] || m[4] || m[6]);
	arg.name = (m[1] || m[3] || m[5]).trim();
	arg.required ||= !!m[1];
	arg.type ||= 'string';

	return new Proxy(
		Object.defineProperty(arg, Internal, {
			configurable: true,
			value: {
				dest: camelCase(arg.name),
				envs,
				state: InternalState.OK,
			},
		}),
		{
			// TODO: wrap set/delete to detect changes
		}
	) as InternalArgument;
}
