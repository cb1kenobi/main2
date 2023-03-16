import {
	Internal,
	InternalOption
} from '../../types.js';

export class OptionRegistry extends Map<string, InternalOption> {
	#chars = {};
	#lookup = {};

	add(opt: InternalOption) {
		const { name } = opt;

		this.set(name, opt);
		this.#lookup[name] = name;

		for (const alias of opt[Internal].short) {
			this.#chars[alias] = name;
		}

		for (const alias of opt[Internal].long) {
			this.#lookup[alias] = name;
		}
	}

	find(name?: string): InternalOption | undefined {
		const key = name && (this.#chars[name] || this.#lookup[name]);
		return key && super.get(key);
	}

	get(name: string): InternalOption | undefined {
		return super.get(this.#lookup[name]);
	}
}
