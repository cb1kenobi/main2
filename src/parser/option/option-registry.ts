import { Internal, InternalOption, Option } from '../../types.js';
import { initOption } from './init-option.js';

export class OptionRegistry extends Map<string, InternalOption> {
	#chars: Record<string, string> = {};
	#lookup: Record<string, string> = {};

	async add(it: Option | InternalOption): Promise<void> {
		const opt = Internal in it ? it : await initOption(it);
		const { name } = opt;

		if (!name || typeof name !== 'string') {
			throw new TypeError(`Invalid option name: ${JSON.stringify(it.name)}`);
		}

		this.set(name, opt as InternalOption);
		this.#lookup[name] = name;

		for (const alias of (opt as InternalOption)[Internal].short) {
			this.#chars[alias] = name;
		}

		for (const alias of (opt as InternalOption)[Internal].long) {
			this.#lookup[alias] = name;
		}
	}

	find(name?: string): InternalOption | undefined {
		// eslint-disable-next-line const-comparisons
		const key = name ? this.#chars[name] || this.#lookup[name] : undefined;
		return key ? super.get(key) : undefined;
	}

	get(name: string): InternalOption | undefined {
		const key = this.#lookup[name];
		return key ? super.get(key) : undefined;
	}
}
