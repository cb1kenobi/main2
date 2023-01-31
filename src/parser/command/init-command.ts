import {
	Command,
	Internal,
	InternalArgument,
	InternalCommand,
	InternalState,
	Schema
} from '../../types.js';
import CommandRegistry from './command-registry.js';
import fs from 'node:fs/promises';
import { initArg } from '../argument/init-arg.js';
import { initOption } from '../option/init-option.js';
import OptionRegistry from '../option/option-registry.js';
import path from 'node:path';

const fileTypeRegExp = /^\.[cm]?js$/;

/**
 * "-a"
 * "-a, --all"
 * "-a --all"
 * "--no-colors"
 * "--opt <value>"
 * "--opt [value]"
 * "--opt=<value>"
 */
// const optionFormatRE = /^(?:-(\w)(?:[ ,|]+)?)?(?:--(no-)?([^\s=]+))?(?:[\s=]+(.+))?$/;

type CommandsLike = Command | InternalCommand | Schema;

export default async function initCommand(it: CommandsLike, commandPath?: string): Promise<InternalCommand> {
	if (typeof it === 'object' && Internal in it && it[Internal].state === InternalState.OK) {
		return it as InternalCommand;
	}

	const command = it as Command;

	if (!it.name || typeof it.name !== 'string') {
		throw new TypeError('Expected command name to be a non-empty string');
	}

	const aliases = new Set<string>();
	const args: InternalArgument[] = [];
	const commands = new CommandRegistry();
	const options = new OptionRegistry();

	if (command.run !== undefined && typeof command.run !== 'function') {
		throw new TypeError(`Invalid run function in "${it.name}" command`);
	}

	if (command.alias !== undefined) {
		const aliasList = typeof command.alias === 'string' ? [ command.alias ] : command.alias;
		if (Array.isArray(aliasList)) {
			for (const alias of aliasList) {
				if (typeof alias !== 'string') {
					throw new TypeError('Expected command alias to be a string or list of strings');
				}
				aliases.add(alias);
			}
		} else {
			throw new TypeError('Expected command alias to be a string or list of strings');
		}
	}

	// args
	if (it.args !== undefined) {
		if (!Array.isArray(it.args)) {
			throw new TypeError('Expected argument list to be an array');
		}

		for (let i = it.args.length - 1, j = i; i >= 0; i--) {
			args[i] = initArg(it.args[i]);
			if (i < j && !args[i].required) {
				args[i].required = args[i + 1].required;
			}
		}
	}

	// commands
	if (it.commands !== undefined) {
		if (it.commands && typeof it.commands === 'string') {
			await registerCommandFile({
				commands,
				file: it.commands
			});

		} else if (Array.isArray(it.commands)) {
			await Promise.all(
				it.commands.map(cmdOrPath => registerCommand({
					cmdOrPath,
					commands
				}))
			);

		} else if (it.commands && typeof it.commands === 'object') {
			await Promise.all(
				Object.entries(it.commands)
					.map(([ name, cmdOrPath ]) => registerCommand({
						cmdOrPath,
						commands,
						name
					}))
			);

		} else {
			throw new TypeError('Expected commands to be one or more paths or an object');
		}
	}

	// options
	if (it.options !== undefined) {
		if (!it.options || typeof it.options !== 'object') {
			throw new TypeError('Expected options to be an object');
		}

		// eslint-disable-next-line prefer-const
		for (let [ format, params ] of Object.entries(it.options)) {
			if (params === undefined || params === null) {
				params = {
					format
				};

			} else if (typeof params === 'string') {
				params = {
					desc: params,
					format
				};

			} else if (params && typeof params === 'object') {
				params.format ??= format;

			} else {
				throw new TypeError('Expected option to be an object');
			}

			options.add(await initOption(params));
		}
	}

	// create the `version` option
	const { version } = it;
	if (version) {
		//  && !commands.has('__version')

		const versionCmd: InternalCommand = await initCommand({
			name: 'version',
			run(state) {
				// state.terminal.write(schema.version);
			}
		});

		options.add(await initOption({
			format: '-v, --version'
			// TODO: use hooks to unshift `versionCmd` onto contexts
		}));
	}

	return new Proxy(Object.defineProperty(
		it,
		Internal, {
			configurable: true,
			value: {
				aliases,
				args,
				commands,
				options,
				path: commandPath || it[Internal]?.path || (Object.hasOwn(it, 'path') ? (it as Command).path : undefined),
				state: InternalState.OK
			}
		}
	), {
		deleteProperty(target, prop) {
			if (typeof prop !== 'string') {
				return false;
			}
			if (prop === 'args') {
				// TODO
			} else if (prop === 'commands') {
				// TODO
			} else if (prop === 'options') {
				// TODO
			} else {
				delete target[prop];
			}
			return true;
		},
		set(target, prop, value) {
			if (typeof prop !== 'string') {
				return false;
			}
			if (prop === 'args') {
				// TODO
			} else if (prop === 'commands') {
				// TODO
			} else if (prop === 'options') {
				// TODO
			} else {
				target[prop] = value;
			}
			return true;
		}
	}) as InternalCommand;
}

async function registerCommand({
	cmdOrPath,
	commands,
	name
}: {
	cmdOrPath: string | Command;
	commands: CommandRegistry;
	name?: string;
}): Promise<void> {
	if (cmdOrPath && typeof cmdOrPath === 'string') {
		await registerCommandFile({
			commands,
			file: cmdOrPath,
			name
		});
	} else if (cmdOrPath && typeof cmdOrPath === 'object') {
		if (cmdOrPath.name === undefined) {
			cmdOrPath.name = name;
		}
		commands.add(await initCommand(cmdOrPath));
	} else {
		throw new TypeError('Expected commands to be one or more paths or an object');
	}
}

async function registerCommandFile({
	commands,
	file,
	name
}: {
	commands: CommandRegistry;
	file: string;
	name?: string;
}): Promise<void> {
	if (!name) {
		try {
			// check if `file` is a directory
			const files = await fs.readdir(file);
			for (const filename of files) {
				const { ext, name } = path.parse(filename);
				if (fileTypeRegExp.test(ext)) {
					commands.add(await initCommand({ name }, path.join(file, filename)));
				}
			}
			return;
		} catch {
			// not a directory, fall through
		}
	}

	// `file` is not a directory or `name` is set and we didn't want to treat
	// it as a directory

	const { ext, name: filename } = path.parse(file);

	if (!name) {
		name = filename;
	}

	if (!ext || !name || !fileTypeRegExp.test(ext)) {
		throw new Error(`Unsupported command module "${file}"`);
	}

	commands.add(await initCommand({ name }, file));
}
