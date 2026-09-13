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
			// the module's own name string, if it has one, wins over the
			// placeholder's
			const renamed = def.name !== undefined;

			// let the setter update the internals

			for (const [key, value] of Object.entries(cmd)) {
				if (def[key] === undefined) {
					def[key] = value;
				}
			}

			// `hidden` is additive, but only the placeholder saw the `!` name
			// prefix, so a module that declares itself visible must not un-hide it
			if (cmd.hidden === true) {
				def.hidden = true;
			}

			// the module never saw the placeholder's name string either, so the
			// aliases parsed from it have to come across as an explicit list
			if (
				internal.aliases.size &&
				(def.alias === undefined || typeof def.alias === 'string' || Array.isArray(def.alias))
			) {
				def.alias = [
					...internal.aliases,
					...(def.alias === undefined
						? []
						: typeof def.alias === 'string'
							? [def.alias]
							: def.alias),
				];
			}

			const loaded = await initCommand(def, file);

			// ...and the same goes for the help label, unless the module renamed
			// the command and brought its own labels
			if (!renamed) {
				loaded[Internal].label = internal.label;
			}

			return loaded;
		}
	}

	return cmd;
}
