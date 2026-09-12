import debug from '../../debug/index.js';
import {
	Command,
	Internal,
	InternalArgument,
	InternalCommand,
	InternalState,
	Schema,
} from '../../types.js';
import { initArg } from '../argument/init-arg.js';
import { OptionRegistry } from '../option/option-registry.js';
import { CommandRegistry } from './command-registry.js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

const { log } = debug('main2:init-command');

const fileTypeRegExp = /^\.[cm]?js$/;
const nameSplitRegExp = /[, ]+/;

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

export async function initCommand(it: CommandsLike, entryFile?: string): Promise<InternalCommand> {
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

	if (command.hidden !== undefined && typeof command.hidden !== 'boolean') {
		throw new TypeError(`Expected hidden to be a boolean in "${it.name}" command`);
	}

	const parsed = parseName(it.name);

	for (const alias of parsed.aliases) {
		aliases.add(alias);
	}

	if (command.alias !== undefined) {
		const aliasList = typeof command.alias === 'string' ? [command.alias] : command.alias;
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
	if (parsed.args.length) {
		if (it.args?.length) {
			throw new Error(`Cannot combine command arguments with inline arguments "${it.name}"`);
		}
		it.args = parsed.args;
	}

	if (it.args !== undefined) {
		if (!Array.isArray(it.args)) {
			throw new TypeError('Expected arguments to be an array');
		}

		for (let i = 0; i < it.args.length; i++) {
			args[i] = initArg(it.args[i]);
		}

		// a variadic argument takes every remaining value, so anything declared
		// after it could never be given a value
		for (let i = 0; i < args.length - 1; i++) {
			if (args[i].multiple) {
				throw new Error(
					`Only the last argument can be variadic: "${args[i].name}..." is followed by "${args[i + 1].name}" in the "${parsed.name}" command`
				);
			}
		}

		// an optional argument before a required one is promoted to required
		// since there is no way to skip it
		for (let i = args.length - 2; i >= 0; i--) {
			if (!args[i].required) {
				args[i].required = args[i + 1].required;
			}
		}
	}

	// A `!` prefixed name and an explicit `hidden` are additive: either one
	// hides the command. An explicit `hidden: false` does not un-hide a `!`
	// prefixed name; drop the `!` to make the command visible.
	command.hidden = parsed.hidden || command.hidden === true;

	if (parsed.name !== it.name) {
		log(`Command name changed "${it.name}" -> "${parsed.name}"`);
		it.name = parsed.name;
	}

	// commands
	if (it.commands !== undefined) {
		if (it.commands && typeof it.commands === 'string') {
			await registerCommandPath({
				commands,
				file: it.commands,
			});
		} else if (Array.isArray(it.commands)) {
			await Promise.all(
				it.commands.map((cmdOrPath) =>
					registerCommand({
						cmdOrPath,
						commands,
					})
				)
			);
		} else if (it.commands && typeof it.commands === 'object') {
			await Promise.all(
				Object.entries(it.commands).map(([name, cmdOrPath]) =>
					registerCommand({
						cmdOrPath,
						commands,
						name,
					})
				)
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
		for (let [format, params] of Object.entries(it.options)) {
			if (params === undefined || params === null) {
				params = {
					format,
				};
			} else if (typeof params === 'string') {
				params = {
					desc: params,
					format,
				};
			} else if (params && typeof params === 'object') {
				params.format ??= format;
			} else {
				throw new TypeError('Expected option to be an object');
			}

			await options.add(params);
		}
	}

	entryFile ??= it[Internal]?.path;

	const { path: commandPath } = it as Command;
	if (commandPath) {
		entryFile = entryFile ? join(dirname(entryFile), commandPath) : commandPath;
	}

	const cmd = new Proxy(
		Object.defineProperty(it, Internal, {
			configurable: true,
			value: {
				aliases,
				args,
				commands,
				label: parsed.label,
				options,
				path: entryFile,
				state: InternalState.OK,
			},
		}),
		{
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
			},
		}
	) as InternalCommand;

	if (command.hooks?.init !== undefined) {
		if (!Array.isArray(command.hooks.init)) {
			throw new TypeError('Expected command init hooks to be an array');
		}
		for (const hook of command.hooks.init) {
			await hook({ cmd, ...cmd[Internal] });
		}
	}

	return cmd;
}

function parseName(unparsedName: string): {
	aliases: string[];
	args: string[];
	hidden: boolean;
	label: string;
	name: string;
} {
	const aliases: string[] = [];
	const args: string[] = [];
	const labels: string[] = [];
	let hidden = false;
	let name: string | undefined;
	let fallbackName: string | undefined;

	for (let label of unparsedName.split(nameSplitRegExp)) {
		if (!label) {
			// a leading, trailing, or doubled separator
			continue;
		}

		const c = label[0];
		if ('<['.includes(c)) {
			args.push(label);
			continue;
		}

		if (c === '!') {
			// "!" hides the command, not just the label it sits on, so a stray
			// "!" still hides rather than quietly doing nothing
			hidden = true;
		}

		if ('!@'.includes(c)) {
			label = label.slice(1);
			if (!label) {
				// a stray "!" or "@" declares no name
				continue;
			}
			aliases.push(label);
			// a prefixed label names the command only if no bare label does
			fallbackName ??= label;
		} else if (name === undefined) {
			// the first bare label is the name...
			name = label;
		} else {
			// ...and every bare label after it is an alias
			aliases.push(label);
		}

		if (c !== '!') {
			labels.push(label);
		}
	}

	name ??= fallbackName;

	if (!name) {
		throw new Error(`Unable to determine command name from "${unparsedName}"`);
	}

	return {
		aliases,
		args,
		hidden,
		label: labels.join(', '),
		name,
	};
}

async function registerCommand({
	cmdOrPath,
	commands,
	name,
}: {
	cmdOrPath: string | Command;
	commands: CommandRegistry;
	name?: string;
}): Promise<void> {
	if (cmdOrPath && typeof cmdOrPath === 'string') {
		await registerCommandPath({
			commands,
			file: cmdOrPath,
			name,
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
	name,
}: {
	commands: CommandRegistry;
	file: string;
	name?: string;
}): Promise<void> {
	const cmd = await registerCommandPackage(file);
	if (cmd) {
		commands.add(cmd);
		return;
	}

	if (!name) {
		try {
			const files = readdirSync(file);
			for (const filename of files) {
				const { ext, name } = parse(filename);
				if (fileTypeRegExp.test(ext)) {
					const cmdFile = join(file, filename);
					commands.add(await initCommand({ name }, cmdFile));
				}
			}
			return;
		} catch {
			// not a package, not a directory
		}
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

	let json;
	try {
		json = readFileSync(pkgFile, 'utf-8');
	} catch {
		// no package.json, not a package
		return;
	}

	let pkgJson;
	try {
		pkgJson = JSON.parse(json);
	} catch (err) {
		throw new Error(`Failed to JSON parse ${pkgFile}: ${err instanceof Error ? err.message : err}`);
	}

	const { description, exports, main, name, type } = pkgJson;

	let entry = exports || main;
	if (entry && typeof entry === 'object') {
		entry = entry['.'] || entry.default;
	}

	const filePaths = entry ? [entry] : ['index.js', 'index.mjs', 'index.cjs'];
	let entryFile;

	for (const filepath of filePaths) {
		try {
			const file = join(dir, filepath);
			const st = statSync(file);
			if (st.isFile()) {
				entryFile = file;
				break;
			}
		} catch {
			// not a file or does not exist
		}
	}

	if (!entryFile) {
		throw new Error(
			`Command package does not have a valid ${type === 'module' ? 'export' : 'main'}: ${dir}`
		);
	}

	const { default: cmd } = await import(entryFile);

	if (!cmd || typeof cmd !== 'object') {
		throw new TypeError(`Expected command package to default export an object: ${entryFile}`);
	}

	cmd.name ??= name;
	cmd.desc ??= description;

	return initCommand(cmd, entryFile);
}
