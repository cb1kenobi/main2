import { CommandRegistry } from './parser/command/command-registry.js';
import { OptionRegistry } from './parser/option/option-registry.js';
import { Terminal } from './terminal.js';

export type AppOptions = {
	argv?:     string[],
	schema?:   Schema;
	terminal?: Terminal;
};

export type Callback = (schema: Schema) => Promise<string>;

export const Internal = Symbol();

export enum InternalState {
	OK    = 1,
	Dirty = 2
}

interface InternalBase {
	state: InternalState;
}

export type DataType =
	| 'auto'
	| 'bool'
	| 'date'
	| 'int'
	| 'json'
	| 'number'
	| 'string'
	| 'yesno';

export type ArgDataType = DataType;

export type Transformer = <T>(value: T, state: ParseState) => Promise<T | unknown>;

export interface Argument {
	[key: string]: unknown; // custom data
	default?:      unknown;
	env?:          string | string[];
	multiple?:     boolean;
	name:          string;
	required?:     boolean;
	transform?:    Transformer;
	type?:         ArgDataType | string;
}

export interface InternalArgument extends Argument {
	[Internal]:    InternalArgumentBase;
	type:          ArgDataType;
}

export interface InternalArgumentBase extends InternalBase {
	dest:          string;
	envs:          Set<string>;
}

export type CommandRunHandler = (state: ParseState) => unknown | Promise<unknown>;

export interface Command {
	[key: string]: unknown; // custom data
	alias?:        string | string[];
	args?:         (string | Argument)[];
	choices?:      unknown[];
	commands?:     Record<string, Command>;
	default?:      boolean;
	desc?:         string;
	file?:         string;
	help?:         string | Callback;
	hidden?:       boolean;
	name?:         string;
	options?:      Record<string, string | Option | undefined | null>;
	path?:         string;
	run?:          CommandRunHandler | null;
}

export interface InternalCommand extends Command {
	[Internal]:    InternalCommandBase;
	name:          string;
}

export interface InternalCommandBase extends InternalBase {
	aliases:       Set<string>;
	args:          InternalArgument[];
	commands:      CommandRegistry;
	label:         string;
	loaded:        boolean;
	options:       OptionRegistry;
	path?:         string;
}

export type DataTransformer = (value: string) => unknown;

export type Hook = (() => Promise<void> | void) |
	((state: ParseState) => Promise<void> | void);

export type BeforeErrorHook = (error: Error, state: ParseState) => Promise<void>;

export type Hooks = {
	beforeParse: Hook[];
	afterParse:  Hook[];
	beforeError: BeforeErrorHook[];
};

export type OptionDataType = DataType | 'count';

/**
 * All properties are optional because most of them can be populated by the
 * format key of the `Command.options`.
 */
export interface Option {
	[key: string]: unknown; // custom data
	alias?:        string | string[];
	choices?:      unknown[];
	default?:      unknown;
	desc?:         string;
	env?:          string | string[];
	format?:       string;
	hidden?:       boolean;
	hint?:         string;
	multiple?:     boolean;
	name?:         string;
	negate?:       boolean;
	required?:     boolean;
	transform?:    Transformer;
	type?:         OptionDataType | string;
}

export interface InternalOption extends Option {
	[Internal]:    InternalOptionBase;
	name:          string;
	type:          OptionDataType;
}

export interface InternalOptionBase extends InternalBase {
	dest:          string;
	envs:          Set<string>;
	isFlag:        boolean;
	label:         string;
	long:          Set<string>;
	short:         Set<string>;
}

export interface ParseOptions {
	argv?:         string[];
	env?:          Record<string, string | undefined>;
	cwd?:          string;
	schema?:       Schema;
}

export enum ParsedType {
	Command = 'Command',
	Extra   = 'Extra',
	Option  = 'Option',
	Unknown = 'Unknown'
}

export interface ParsedBase {
	inputs:        (string | undefined)[];
	type:          ParsedType;
}

export interface ParsedCommand extends ParsedBase {
	cmd:           InternalCommand;
	type:          ParsedType.Command;
}

export interface ParsedExtra extends ParsedBase {
	type:          ParsedType.Extra;
}

export interface ParsedOption extends ParsedBase {
	option:        InternalOption;
	type:          ParsedType.Option;
	value?:        unknown;
}

export interface ParsedUnknown extends ParsedBase {
	type:          ParsedType.Unknown;
}

export type ParsedValue = ParsedCommand | ParsedExtra | ParsedOption | ParsedUnknown;

export interface ParseState {
	$orig:         string[];
	$:             ParsedValue[];
	_:             unknown[];
	argv:          Record<string, unknown>;
	cmd?:          InternalCommand;
	contexts:      InternalCommand[];
	env:           Record<string, string | undefined>;
	hooks:         Hooks;
	schema:        Schema;
}

export interface Schema {
	args?:         (string | Argument)[];
	commands?:     string | (string | Command)[] | Record<string, string | Command>;
	help?:         boolean;
	hooks?:        Partial<Hooks>;
	name?:         string;
	options?:      Record<string, string | Option | undefined | null>;
	settings?:     Settings;
	version?:      unknown;
}

export interface Settings {
	allowExtraArguments?:      boolean;
	allowUnexpectedArguments?: boolean;
	helpExitCode?:             number;
}
