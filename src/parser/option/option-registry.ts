import { initOption } from './init-option.js';
import {
	Internal,
	InternalOption,
	Option
} from '../../types.js';

export class OptionRegistry extends Map<string, InternalOption> {
	#chars: Record<string, string> = {};
	#lookup: Record<string, string> = {};

	async add(it: Option | InternalOption) {
		const opt = Internal in it ? it : await initOption(it);
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
		// eslint-disable-next-line const-comparisons
		const key = name ? (this.#chars[name] || this.#lookup[name]) : undefined;
		return key ? super.get(key) : undefined;
	}

	get(name: string): InternalOption | undefined {
		const key = this.#lookup[name];
		return key ? super.get(key) : undefined;
	}
}
