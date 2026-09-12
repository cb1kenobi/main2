import debug from './debug/index.js';
import { errorHandler } from './error-handler.js';
import { fireBeforeError, stateFromError } from './error-hooks.js';
import { type AppOptions, type ParseState } from './types.js';

export * from './types.js';
export { errorExitCode, errorHandler, renderError } from './error-handler.js';

const { log } = debug('main2');

/*
get cwd(): string {
    return process.cwd();
  }

  set cwd(v: string) {
    process.chdir(v);
	}
*/

/**
 * Parses argv against the schema and runs the command that wins.
 *
 * Errors thrown by `parse()` or by the command's `run()` are rendered by
 * `errorHandler()` -- the message, no stack trace -- and turned into a
 * non-zero `process.exitCode`; `main2()` then resolves with `undefined`. A
 * bin script is the expected caller, so failing loudly through an unhandled
 * rejection is the wrong default. Set `settings.errorHandler` to `false` to
 * have the error rethrown instead, or to a function to render it yourself.
 *
 * @param opts - The app options.
 * @returns The command's return value, the parse state when the command
 * returned nothing or no command ran, or `undefined` when an error was
 * handled.
 */
export async function main2(opts: AppOptions = {}): Promise<ParseState | unknown> {
	let state: ParseState | undefined;
	let hooksFired = false;

	try {
		if (opts?.settings?.assertCwd !== false) {
			assertCwd();
		}

		const { parse } = await import('./parser/parse.js');

		try {
			state = await parse({
				argv: opts.argv || process.argv.slice(2),
				env: process.env,
				schema: opts.schema,
				settings: opts.settings,
			});
		} catch (err) {
			// `parse()` owns its own error path and has already fired the hooks
			// on whatever it throws -- firing them again here would double up
			hooksFired = true;
			throw err;
		}

		const { cmd } = state;
		if (cmd?.run) {
			log(`Executing command "${cmd.name}"`);
			return (await cmd.run(state)) ?? state;
		}

		return state;
	} catch (err) {
		// a parse error never got to return a state, but it carries the one it
		// died with, which is where the matched command comes from
		return await handleError(err, state ?? stateFromError(err), opts, hooksFired);
	}
}

/**
 * The single error path for `main2()`. Everything thrown between the working
 * directory check and the command's `run()` resolving arrives here.
 *
 * @param err - The thrown value.
 * @param state - The parse state, if parsing got far enough to produce one.
 * @param opts - The app options.
 * @param hooksFired - Set when the `beforeError` hooks have already run, which
 * is every error `parse()` threw.
 */
async function handleError(
	err: unknown,
	state: ParseState | undefined,
	opts: AppOptions,
	hooksFired = false
): Promise<undefined> {
	// the hooks fire before anything is rendered and before the opt-out below,
	// so the error a hook replaced is the one that gets rendered, handed to a
	// custom handler, or rethrown -- the same error whichever way it leaves
	const reported = hooksFired ? err : await fireBeforeError(err, state, opts?.schema);

	const handler = opts?.settings?.errorHandler;

	if (handler === false) {
		throw reported;
	}

	if (typeof handler === 'function') {
		await handler(reported, { state });
		return;
	}

	errorHandler(reported, { state });
}

function assertCwd() {
	try {
		process.cwd();
	} catch (err) {
		if (err instanceof Error && err.message.includes('uv_cwd')) {
			throw new Error('Current working directory does not exist');
		}
	}
}

export default main2;
