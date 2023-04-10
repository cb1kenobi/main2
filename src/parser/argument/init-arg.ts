import { camelCase } from '../../util/camel-case.js';
import {
	Argument,
	InternalState,
	Internal,
	InternalArgument
} from '../../types.js';

// foo      optional
// <foo>	required
// [foo]	optional
// foo...	optional, multiple

const argRequiredRE = /^(?:<([\w-]+)>|\[([\w-]+)\]|([\w-]+?))\s*(\.\.\.)?$/;
const argTypesRE    = /^auto|bool|date|int|json|number|string|yesno$/;

export function initArg(it: string | Argument | InternalArgument): InternalArgument {
	if (it && typeof it === 'object' && Internal in it && it[Internal]?.state === InternalState.OK) {
		return it;
	}

	if (typeof it === 'string') {
		it = {
			name: it
		};
	}

	if (!it || typeof it !== 'object') {
		throw new TypeError(`Invalid argument definition: ${it}`);
	}

	let { name } = it;

	if (!name || typeof name !== 'string') {
		if (typeof name === 'number') {
			name = String(name);
		} else {
			throw new Error('Expected argument to have a name');
		}
	}

	const m = name.match(argRequiredRE);
	if (!m) {
		throw new Error(`Invalid argument name: ${JSON.stringify(it.name)}`);
	}

	const envs = new Set();
	if (it.env !== undefined) {
		const env = typeof it.env === 'string' ? [it.env] : it.env;

		if (!Array.isArray(env)) {
			throw new TypeError('Expected argument environment variable to be a string or array of strings');
		}

		for (const e of env) {
			if (e && typeof e === 'string') {
				envs.add(e);
			}
		}
	}

	if (it.type !== undefined && !argTypesRE.test(it.type)) {
		throw new Error(`Argument "${it.name}" has unsupported data type "${it.type}"`);
	}

	if (it.transform && typeof it.transform !== 'function') {
		throw new TypeError('Expected argument transform function to be a function');
	}

	it.multiple ||= !!m[4];
	it.name       = (m[1] || m[2] || m[3]).trim();
	it.required ||= !!m[1];
	it.type     ||= 'auto';

	return new Proxy(Object.defineProperty(
		it,
		Internal,
		{
			configurable: true,
			value: {
				dest: camelCase(it.name),
				envs
			}
		}
	), {
		// TODO: wrap set/delete to detect changes
	}) as InternalArgument;
}
