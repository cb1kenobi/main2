import { CommandRegistry } from './parser/command/command-registry.js';
import { OptionRegistry } from './parser/option/option-registry.js';
import { Terminal } from './terminal.js';

export type AppOptions = {
	argv?: string[];
	schema?: Schema;
	settings?: Settings;
	terminal?: Terminal;
};

export type Callback = (schema: Schema) => Promise<string>;

export const Internal: unique symbol = Symbol();

export enum InternalState {
	OK = 1,
	Dirty = 2,
}

interface InternalBase {
	state: InternalState;
}

export type DataType = 'auto' | 'bool' | 'date' | 'int' | 'json' | 'number' | 'string' | 'yesno';

export type ArgDataType = DataType;

export type Transformer = <T>(value: T, state: ParseState) => Promise<T | unknown>;

export interface Argument {
	[key: string]: unknown; // custom data
	choices?: unknown[];
	default?: unknown;
	env?: string | string[];
	multiple?: boolean;
	name: string;
	required?: boolean;
	transform?: Transformer;
	type?: ArgDataType | string;
}

export interface InternalArgument extends Argument {
	[Internal]: InternalArgumentBase;
	type: ArgDataType;
}

export interface InternalArgumentBase extends InternalBase {
	dest: string;
	envs: Set<string>;
}

export type CommandRunHandler = (state: ParseState) => unknown | Promise<unknown>;

export interface CommandExample {
	label: string;
	text: string;
}

export interface Command {
	[key: string]: unknown; // custom data
	alias?: string | string[];
	args?: (string | Argument)[];
	choices?: unknown[];
	commands?: Record<string, Command>;
	default?: boolean;
	desc?: string;
	examples?: CommandExample;
	file?: string;
	help?: string | Callback;
	hidden?: boolean;
	hooks?: {
		init?: CommandHook[];
		parse?: CommandHook[];
	};
	name?: string;
	options?: Record<string, string | Option | undefined | null>;
	path?: string;
	run?: CommandRunHandler | null;
}

export interface InternalCommand extends Command {
	[Internal]: InternalCommandBase;
	name: string;
}

export interface InternalCommandBase extends InternalBase {
	aliases: Set<string>;
	args: InternalArgument[];
	commands: CommandRegistry;
	label: string;
	loaded: boolean;
	options: OptionRegistry;
	path?: string;
}

export type CommandHook =
	| (() => Promise<void> | void)
	| ((state: CommandHookData) => Promise<void> | void);

export type CommandHookData = InternalCommandBase & {
	cmd: Command;
};

export type DataTransformer = (value: string) => unknown;

export type OptionDataType = DataType | 'count';

/**
 * All properties are optional because most of them can be populated by the
 * format key of the `Command.options`.
 */
export interface Option {
	[key: string]: unknown; // custom data
	alias?: string | string[];
	choices?: unknown[];
	default?: unknown;
	desc?: string;
	env?: string | string[];
	format?: string;
	hidden?: boolean;
	hint?: string;
	multiple?: boolean;
	name?: string;
	negate?: boolean;
	required?: boolean;
	transform?: Transformer;
	type?: OptionDataType | string;
}

export interface InternalOption extends Option {
	[Internal]: InternalOptionBase;
	name: string;
	type: OptionDataType;
}

export interface InternalOptionBase extends InternalBase {
	dest: string;
	envs: Set<string>;
	isFlag: boolean;
	label: string;
	long: Set<string>;
	short: Set<string>;
}

export interface ParseOptions {
	argv?: string[];
	env?: Record<string, string | undefined>;
	cwd?: string;
	schema?: Schema;
	settings?: Settings;
}

export type ParsedType = 'Command' | 'Extra' | 'Option' | 'Unknown' | 'UnknownOption';

export interface ParsedBase {
	inputs: (string | undefined)[];
	/**
	 * The token exactly as it appeared in argv, before `--opt=value` was split
	 * into separate inputs. An option that consumes this token as its value
	 * needs the original spelling back, otherwise the part after the `=` is
	 * silently lost.
	 */
	orig?: string;
	type: ParsedType;
}

export interface ParsedCommand extends ParsedBase {
	cmd: InternalCommand;
	type: 'Command';
}

export interface ParsedExtra extends ParsedBase {
	type: 'Extra';
}

export interface ParsedOption extends ParsedBase {
	option: InternalOption;
	type: 'Option';
	value?: unknown;
}

export interface ParsedUnknown extends ParsedBase {
	type: 'Unknown';
}

/**
 * An option-like token that no context declared. It still produces a value on
 * `argv` unless `settings.allowUnknownOptions` is `false`.
 */
export interface ParsedUnknownOption extends ParsedBase {
	dest: string;
	type: 'UnknownOption';
	value: unknown;
}

export type ParsedValue =
	| ParsedCommand
	| ParsedExtra
	| ParsedOption
	| ParsedUnknown
	| ParsedUnknownOption;

export interface ParseState {
	$orig: string[];
	$: ParsedValue[];
	_: unknown[];
	argv: Record<string, unknown>;
	cmd?: InternalCommand;
	contexts: InternalCommand[];
	env: Record<string, string | undefined>;
	schema: Schema;
	settings: Settings;
}

export interface Schema {
	args?: (string | Argument)[];
	commands?: string | (string | Command)[] | Record<string, string | Command>;
	help?: boolean;
	hooks?: {
		beforeParse?: SchemaHook[];
		afterParse?: SchemaHook[];
		beforeError?: BeforeErrorHook[];
	};
	name?: string;
	options?: Record<string, string | Option | undefined | null>;
}

export type BeforeErrorHook = (error: Error, state: ParseState) => Promise<void>;

export type SchemaHook =
	| (() => Promise<void> | void)
	| ((state: ParseState) => Promise<void> | void);

export interface Settings {
	allowExtraArguments?: boolean;
	allowUnexpectedArguments?: boolean;
	allowUnknownOptions?: boolean;
	assertCwd?: boolean;
	helpExitCode?: number;
}
