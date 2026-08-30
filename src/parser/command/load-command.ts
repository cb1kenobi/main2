import debug from '../../debug/index.js';
import { Internal, InternalCommand } from '../../types.js';
import { initCommand } from './init-command.js';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { log } = debug('main2:parser:load-command');

export async function loadCommand(cmd: InternalCommand): Promise<InternalCommand> {
	const internal = cmd[Internal];

	if (internal.loaded) {
		return cmd;
	}

	cmd[Internal].loaded = true;

	if (internal.path) {
		const file = pathToFileURL(internal.path).toString();
		log(`Loading command: ${file}`);

		if (!existsSync(internal.path)) {
			throw new Error(`Command module not found: ${internal.path}`);
		}

		let def;
		try {
			def = (await import(file)).default;
		} catch (e: unknown) {
			throw new Error(`Failed to load command module: ${(<Error>e).message}`);
		}

		if (typeof def !== 'object') {
			throw new TypeError(
				`Command module default export is not a valid command object: ${internal.path}`
			);
		}

		if (def) {
			// let the setter update the internals

			for (const [key, value] of Object.entries(cmd)) {
				if (def[key] === undefined) {
					def[key] = value;
				}
			}

			return initCommand(def, file);
		}
	}

	return cmd;
}
