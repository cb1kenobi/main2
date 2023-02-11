import {
	Command,
	Internal,
	InternalArgument,
	InternalCommand,
	InternalState,
	Schema
} from '../../types.js';
import CommandRegistry from './command-registry.js';
import debug from '../../debug/index.js';
import { dirname, isAbsolute, join, parse } from 'node:path';
import fs from 'node:fs/promises';
import { initArg } from '../argument/init-arg.js';
import { initOption } from '../option/init-option.js';
import OptionRegistry from '../option/option-registry.js';

const { log } = debug('main2:init-commands');

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

export default async function initCommand(it: CommandsLike, entryFile?: string): Promise<InternalCommand> {
	if (typeof it === 'object' && Internal in it && it[Internal].state === InternalState.OK) {
		return it as InternalCommand;
	}

	const command = it as Command;

	if (!it.name || typeof it.name !== 'string') {
		throw new TypeError('Expected command name to be a non-empty string');
	}

	log(`Initializing command "${it.name}"`);

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
			await registerCommandPath({
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
	// const { version } = it;
	// if (version) {
	// 	//  && !commands.has('__version')

	// 	const versionCmd: InternalCommand = await initCommand({
	// 		name: 'version',
	// 		run(state) {
	// 			// state.terminal.write(schema.version);
	// 		}
	// 	});

	// 	options.add(await initOption({
	// 		format: '-v, --version'
	// 		// TODO: use hooks to unshift `versionCmd` onto contexts
	// 	}));
	// }

	entryFile ??= it[Internal]?.path;

	const { path: commandPath } = it as Command;
	if (commandPath) {
		entryFile = entryFile ? join(dirname(entryFile), commandPath) : commandPath;
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
				path: entryFile,
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
		await registerCommandPath({
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

async function registerCommandPath({
	commands,
	file,
	name
}: {
	commands: CommandRegistry;
	file: string;
	name?: string;
}): Promise<void> {
	if (!name) {
		const cmd = await registerCommandPackage(file);
		if (cmd) {
			commands.add(cmd);
			return;
		}

		const files = await fs.readdir(file).catch(err => err);
		if (!(files instanceof Error)) {
			for (const filename of files) {
				const { ext, name } = parse(filename);
				if (fileTypeRegExp.test(ext)) {
					const cmdFile = join(file, filename);
					commands.add(await initCommand({ name }, cmdFile));
				}
			}
			return;
		}

		// not a package, not a directory
	}

	// `file` is not a package or directory or `name` is set and we didn't want
	// to treat it as a directory

	const { ext, name: filename } = parse(file);

	if (!name) {
		name = filename;
	}

	if (!ext || !name || !fileTypeRegExp.test(ext)) {
		throw new Error(`Unsupported command module "${file}"`);
	}

	commands.add(await initCommand({ name }, file));
}

async function registerCommandPackage(dir: string): Promise<InternalCommand | undefined> {
	const pkgFile = join(dir, 'package.json');
	const json = await fs.readFile(pkgFile, 'utf-8').catch(err => err);

	if (json instanceof Error) {
		// no package.json, not a package
		return;
	}

	let pkgJson;
	try {
		pkgJson = JSON.parse(json);
	} catch (err: any) {
		throw new Error(`Failed to JSON parse ${pkgFile}: ${err.message}`);
	}

	let { description, exports, main, name } = pkgJson;

	let entry = exports || main;
	if (entry && typeof entry === 'object') {
		entry = entry['.'] || entry.default;
	}

	if (!entry || typeof entry !== 'string') {
		throw new Error(`Command package does not have a valid main: ${dir}`);
	}

	const entryFile = join(dir, entry);
	const { default: cmd } = await import(entryFile);

	if (!cmd || typeof cmd !== 'object') {
		throw new TypeError(`Expected command package "${name}" to default export an object`);
	}

	cmd.name ??= name;
	cmd.desc ??= description;

	return initCommand(cmd, entryFile);
}
