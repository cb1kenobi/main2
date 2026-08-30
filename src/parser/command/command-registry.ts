import { Internal, InternalCommand } from '../../types.js';

export class CommandRegistry extends Map<string, InternalCommand> {
	#lookup: Record<string, string> = {};

	add(cmd: InternalCommand): void {
		const { name } = cmd;

		this.set(name, cmd);
		this.#lookup[name] = name;

		for (const alias of cmd[Internal].aliases) {
			this.#lookup[alias] = name;
		}
	}

	find(name?: string): InternalCommand | undefined {
		return name ? super.get(this.#lookup[name]) : undefined;
	}
}
