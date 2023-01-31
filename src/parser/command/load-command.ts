import debug from '../../debug/index.js';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Internal, InternalCommand } from '../../types.js';

const { log } = debug('opentl:parser:load-command');

export default async function loadCommand(cmd: InternalCommand): Promise<InternalCommand> {
	const internal = cmd[Internal];

	if (internal.loaded) {
		return cmd;
	}

	if (internal.path) {
		const file = pathToFileURL(internal.path).toString();
		log(`Loading command: ${file}`);

		try {
			await fs.access(internal.path);
		} catch {
			throw new Error(`Command module not found: ${internal.path}`);
		}

		let def;
		try {
			def = (await import(file)).default;
		} catch (e: unknown) {
			throw new Error(`Failed to load command module: ${(<Error>e).message}`);
		}

		if (typeof def !== 'object') {
			throw new TypeError(`Command module default export is not a valid command object: ${internal.path}`);
		}

		if (def) {
			// let the setter update the internals
			Object.assign(cmd, def);
		}
	}

	cmd[Internal].loaded = true;

	return cmd;
}
