import { main2 } from '../src/index.js';
import type { ErrorContext, ParseState } from '../src/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Captures whatever the built-in error handler writes to the real stderr.
 */
function captureStderr() {
	const chunks: string[] = [];
	const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((
		chunk: string | Uint8Array
	) => {
		chunks.push(chunk.toString());
		return true;
	}) as typeof process.stderr.write);

	return {
		restore: () => spy.mockRestore(),
		get text() {
			return chunks.join('');
		},
	};
}

describe('main2', () => {
	let exitCode: typeof process.exitCode;

	beforeEach(() => {
		exitCode = process.exitCode;
	});

	afterEach(() => {
		// a leaked exit code would fail the entire test run
		process.exitCode = exitCode;
		vi.restoreAllMocks();
	});

	describe('happy path', () => {
		it('should resolve the parse state when no command runs', async () => {
			const result = (await main2({
				argv: ['--verbose'],
				schema: { options: { '-v, --verbose': 'Print more output' } },
			})) as ParseState;

			expect(result.argv.verbose).toBe(true);
			expect(process.exitCode).toBe(exitCode);
		});

		it('should run the matched command and resolve its return value', async () => {
			const result = await main2({
				argv: ['build'],
				schema: { commands: { build: { run: () => 'built' } } },
			});

			expect(result).toBe('built');
		});

		it('should resolve the parse state when the command returns nothing', async () => {
			const result = (await main2({
				argv: ['build'],
				schema: { commands: { build: { run: () => undefined } } },
			})) as ParseState;

			expect(result.cmd?.name).toBe('build');
		});
	});

	describe('error handling', () => {
		it('should render a parse error and set a non-zero exit code', async () => {
			const stderr = captureStderr();
			const result = await main2({
				argv: [],
				schema: { options: { '--name <value>': 'Your name' } },
			});
			stderr.restore();

			expect(stderr.text).toBe('Error: Missing required options: --name\n');
			expect(stderr.text).not.toContain('at ');
			expect(result).toBeUndefined();
			expect(process.exitCode).toBe(1);
		});

		it('should render an error thrown by the command handler', async () => {
			const stderr = captureStderr();
			await main2({
				argv: ['build'],
				schema: {
					commands: {
						build: {
							run() {
								throw new Error('build failed');
							},
						},
					},
				},
			});
			stderr.restore();

			expect(stderr.text).toBe('Error: build failed\n');
			expect(process.exitCode).toBe(1);
		});

		it('should render an async rejection from the command handler', async () => {
			const stderr = captureStderr();
			await main2({
				argv: ['build'],
				schema: {
					commands: {
						build: {
							run: async () => {
								await Promise.resolve();
								throw Object.assign(new Error('deploy failed'), { exitCode: 4 });
							},
						},
					},
				},
			});
			stderr.restore();

			expect(stderr.text).toBe('Error: deploy failed\n');
			expect(process.exitCode).toBe(4);
		});

		it('should render a thrown value that is not an error', async () => {
			const stderr = captureStderr();
			await main2({
				argv: ['build'],
				schema: {
					commands: {
						build: {
							run() {
								throw 'just a string';
							},
						},
					},
				},
			});
			stderr.restore();

			expect(stderr.text).toBe('Error: just a string\n');
			expect(process.exitCode).toBe(1);
		});

		it('should rethrow when the error handler is turned off', async () => {
			await expect(
				main2({
					argv: [],
					schema: { options: { '--name <value>': 'Your name' } },
					settings: { errorHandler: false },
				})
			).rejects.toThrow('Missing required options: --name');

			expect(process.exitCode).toBe(exitCode);
		});

		it('should rethrow a command handler error when turned off', async () => {
			await expect(
				main2({
					argv: ['build'],
					schema: {
						commands: {
							build: {
								run() {
									throw new Error('build failed');
								},
							},
						},
					},
					settings: { errorHandler: false },
				})
			).rejects.toThrow('build failed');
		});

		it('should call a custom error handler with the error and the state', async () => {
			let seen: unknown;
			let ctx: ErrorContext | undefined;

			const result = await main2({
				argv: ['build'],
				schema: {
					commands: {
						build: {
							run() {
								throw new Error('build failed');
							},
						},
					},
				},
				settings: {
					errorHandler: (err, c) => {
						seen = err;
						ctx = c;
					},
				},
			});

			expect((seen as Error).message).toBe('build failed');
			expect(ctx?.state?.cmd?.name).toBe('build');
			expect(result).toBeUndefined();
			// a custom handler owns the exit code
			expect(process.exitCode).toBe(exitCode);
		});

		it('should await an async custom error handler', async () => {
			const calls: string[] = [];

			await main2({
				argv: [],
				schema: { options: { '--name <value>': 'Your name' } },
				settings: {
					errorHandler: async () => {
						await Promise.resolve();
						calls.push('handled');
					},
				},
			});

			expect(calls).toEqual(['handled']);
		});

		it('should reject when a custom error handler throws', async () => {
			// swallowing this would leave nothing at all reporting either error
			await expect(
				main2({
					argv: [],
					schema: { options: { '--name <value>': 'Your name' } },
					settings: {
						errorHandler: () => {
							throw new Error('handler exploded');
						},
					},
				})
			).rejects.toThrow('handler exploded');
		});

		it('should hand the handler no state when parsing never produced one', async () => {
			let ctx: ErrorContext | undefined;

			await main2({
				schema: 'nope' as never,
				argv: [],
				settings: {
					errorHandler: (_err, c) => {
						ctx = c;
					},
				},
			});

			expect(ctx?.state).toBeUndefined();
		});

		it('should handle bad app options rather than crashing', async () => {
			const stderr = captureStderr();
			await main2(null as never);
			stderr.restore();

			expect(stderr.text).toContain('Error: ');
			expect(process.exitCode).toBe(1);
		});
	});
});
