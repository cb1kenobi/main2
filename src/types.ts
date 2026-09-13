import { CommandRegistry } from './parser/command/command-registry.js';
import { OptionRegistry } from './parser/option/option-registry.js';

export type AppOptions = {
	argv?: string[];
	schema?: Schema;
	settings?: Settings;
};

export type Callback = (schema: Schema) => Promise<string>;

export const Internal: unique symbol = Symbol();

/**
 * The key `parse()` stashes its in-flight `ParseState` under on any error it
 * throws once that state exists.
 *
 * The errors that most need a usage line -- a missing required option, an
 * unexpected argument -- are the ones that stop `parse()` from ever returning,
 * so the error is the only way the matched command gets back out. A symbol,
 * and non-enumerable, so nothing inspecting the error ever sees it.
 */
export const ErrorState: unique symbol = Symbol('main2.errorState');

/**
 * How far along an `init*()` call got. Only `OK` is trusted: an object in any
 * other state is rebuilt from scratch the next time it is initialized.
 */
export enum InternalState {
	/** Fully built, and safe to hand straight back. */
	OK = 1,
	/**
	 * Built, but not finished — a command stays here until its init hooks have
	 * all resolved, so a hook that throws leaves nothing half built behind.
	 */
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
	/** What the argument is for, as help prints it. */
	desc?: string;
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
	examples?: CommandExample | CommandExample[];
	file?: string;
	help?: string | Callback;
	hidden?: boolean;
	hooks?: {
		beforeError?: BeforeErrorHook[];
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
	/**
	 * Whether `loadCommand()` has finished with this command. Always set: it
	 * starts `false` and flips once there is nothing left to fetch — either the
	 * module came in, or the command never had one. A load that throws leaves it
	 * `false` so the next match tries again.
	 */
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
	/** The parser supplied the default, the declaration did not. */
	impliedDefault: boolean;
	isFlag: boolean;
	label: string;
	long: Set<string>;
	/** The negated flag declared alongside this option, sharing its destination. */
	negatedTwin?: InternalOption;
	short: Set<string>;
	/** Another option owns the default for the destination they share. */
	skipDefault: boolean;
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
		/**
		 * Fires on the way out of any error. Commands in the context chain
		 * declare their own, and those run first; see `BeforeErrorHook`.
		 */
		beforeError?: BeforeErrorHook[];
	};
	name?: string;
	options?: Record<string, string | Option | undefined | null>;
}

/**
 * Fires for every error on its way out of `parse()` or `main2()`, before the
 * error is rendered, handed to a custom handler, or rethrown.
 *
 * A hook may observe the error, mutate it, or return a replacement -- it may
 * never suppress it. Returning `undefined`, which is what a hook that only
 * looks returns, keeps the error as it is; returning anything else makes that
 * value the error from there on. A hook that throws is logged under
 * `DEBUG=main2:error` and skipped, leaving the error it was given in flight.
 *
 * Neither argument can be narrower than this: anything at all can be thrown,
 * and an error raised before there was a parse state -- an invalid schema, an
 * option format that will not parse -- arrives without one.
 *
 * @param err - The thrown value.
 * @param state - The parse state, when parsing got far enough to produce one.
 * @returns A replacement error, or `undefined` to keep the current one.
 */
export type BeforeErrorHook = (
	err: unknown,
	state: ParseState | undefined
) => unknown | Promise<unknown>;

export type SchemaHook =
	| (() => Promise<void> | void)
	| ((state: ParseState) => Promise<void> | void);

export interface Settings {
	allowExtraArguments?: boolean;
	allowUnexpectedArguments?: boolean;
	allowUnknownOptions?: boolean;
	assertCwd?: boolean;
	/**
	 * How `main2()` deals with an error thrown by `parse()` or by the matched
	 * command's `run()`.
	 *
	 * Unset, the built-in `errorHandler()` renders the message to stderr, sets
	 * `process.exitCode`, and `main2()` resolves with `undefined`. Set it to
	 * `false` to have `main2()` rethrow instead and handle the error yourself,
	 * or to a function to replace the built-in handler entirely.
	 */
	errorHandler?: ErrorHandler | false;
	helpExitCode?: number;
}

/**
 * What the error path knows beyond the error itself. Phase 3's help rendering
 * reads the matched command off `state` to print the relevant usage line.
 */
export interface ErrorContext {
	/** The parse state, when parsing got far enough to produce one. */
	state?: ParseState;
}

/**
 * Turns a thrown value into the text written to stderr. Replacing this is how
 * richer rendering -- usage lines, ANSI color -- plugs in.
 */
export type ErrorRenderer = (err: unknown, ctx: ErrorContext) => string;

/**
 * A complete replacement for the built-in error handler, set via
 * `Settings.errorHandler`. It owns the output and the exit code. A handler
 * that throws rejects `main2()` -- that is a bug in the handler, and hiding
 * it would leave nothing at all reporting the original error.
 */
export type ErrorHandler = (err: unknown, ctx: ErrorContext) => Promise<void> | void;

export interface ErrorHandlerOptions extends ErrorContext {
	/** Replaces the default renderer. */
	render?: ErrorRenderer;
	/** Where the rendered error is written. Defaults to `process.stderr`. */
	stderr?: NodeJS.WritableStream;
}
