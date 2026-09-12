import { main2 } from '../../src/index.js';
import { parse } from '../../src/parser/parse.js';
import { ErrorState, type ParseState } from '../../src/types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('default command', () => {
	describe('dispatch', () => {
		it('should dispatch the default command when argv names none', async () => {
			const state = await parse({
				argv: [],
				schema: {
					commands: {
						build: { default: true },
						test: {},
					},
				},
			});

			expect(state.cmd?.name).toBe('build');
			expect(state.contexts.map((c) => c.name)).toStrictEqual(['build', 'global']);
		});

		it('should not add a token to the parsed stream for a name nobody typed', async () => {
			const state = await parse({
				argv: [],
				schema: { commands: { build: { default: true } } },
			});

			// `$` is the classified token stream, and no token named the command
			expect(state.$).toHaveLength(0);
		});

		it('should not dispatch when no command is marked default', async () => {
			const state = await parse({
				argv: [],
				schema: { commands: { build: {}, test: {} } },
			});

			expect(state.cmd).toBeUndefined();
			expect(state.contexts.map((c) => c.name)).toStrictEqual(['global']);
		});

		it('should not dispatch a command whose default is false', async () => {
			const state = await parse({
				argv: [],
				schema: { commands: { build: { default: false } } },
			});

			expect(state.cmd).toBeUndefined();
		});

		it('should let an explicit command name beat the default', async () => {
			const state = await parse({
				argv: ['test'],
				schema: {
					commands: {
						build: { default: true },
						test: {},
					},
				},
			});

			expect(state.cmd?.name).toBe('test');
			expect(state.contexts.map((c) => c.name)).toStrictEqual(['test', 'global']);
		});

		it('should dispatch the default command only once when it is also typed', async () => {
			const state = await parse({
				argv: ['build'],
				schema: { commands: { build: { default: true } } },
			});

			expect(state.cmd?.name).toBe('build');
			expect(state.contexts.map((c) => c.name)).toStrictEqual(['build', 'global']);
			expect(state.$.filter((a) => a.type === 'Command')).toHaveLength(1);
		});

		it('should run the default command from main2()', async () => {
			const result = await main2({
				argv: [],
				schema: { commands: { build: { default: true, run: () => 'built' } } },
			});

			expect(result).toBe('built');
		});

		it('should load a lazily loaded default command module', async () => {
			const state = await parse({
				argv: [],
				schema: {
					commands: {
						foo: {
							default: true,
							path: path.join(__dirname, 'fixtures/simple/foo.js'),
						},
					},
				},
			});

			expect(state.cmd?.name).toBe('foo');
			expect(state.cmd?.desc).toBe('foo!');
			expect(state.contexts[0].desc).toBe('foo!');
		});

		it('should fire the default command parse hook', async () => {
			const names: string[] = [];

			await parse({
				argv: [],
				schema: {
					commands: {
						build: {
							default: true,
							hooks: { parse: [({ cmd }) => void names.push(cmd.name as string)] },
						},
					},
				},
			});

			expect(names).toStrictEqual(['build']);
		});
	});

	describe('arguments', () => {
		it('should bind positional values to the default command', async () => {
			const state = await parse({
				argv: ['out.js'],
				schema: {
					commands: {
						build: { args: ['<entry>'], default: true },
					},
				},
			});

			expect(state.cmd?.name).toBe('build');
			expect(state.argv.entry).toBe('out.js');
			expect(state._).toStrictEqual(['out.js']);
		});

		it('should report the required arguments the default command never got', async () => {
			// the default command is the command that ran, so its own requirements
			// are the ones that apply -- and naming the missing argument beats
			// silently doing nothing
			await expect(
				parse({
					argv: [],
					schema: { commands: { build: { args: ['<entry>'], default: true } } },
				})
			).rejects.toThrow(new Error('Missing required arguments: <entry>'));
		});

		it('should carry the default command on a missing argument error', async () => {
			const err = await parse({
				argv: [],
				schema: { commands: { build: { args: ['<entry>'], default: true } } },
			}).catch((e: unknown) => e);

			const state = (err as { [ErrorState]?: ParseState })[ErrorState];
			expect(state?.cmd?.name).toBe('build');
		});

		it('should apply the default command argument defaults', async () => {
			const state = await parse({
				argv: [],
				schema: {
					commands: {
						build: {
							args: [{ name: 'entry', default: 'index.js' }],
							default: true,
						},
					},
				},
			});

			expect(state.argv.entry).toBe('index.js');
		});

		it('should reject an unexpected argument against the default command', async () => {
			await expect(
				parse({
					argv: ['nope'],
					schema: { commands: { build: { default: true } } },
				})
			).rejects.toThrow(new Error('Unexpected argument "nope"'));
		});

		it('should match a subcommand of the default command', async () => {
			// the default stands in for a name that was never typed, so the token
			// that follows resolves against it exactly as `build all` would
			const state = await parse({
				argv: ['all'],
				schema: {
					commands: {
						build: { commands: { all: {} }, default: true },
					},
				},
			});

			expect(state.cmd?.name).toBe('all');
			expect(state.contexts.map((c) => c.name)).toStrictEqual(['all', 'build', 'global']);
		});
	});

	describe('options', () => {
		it('should resolve an option the default command declares', async () => {
			const state = await parse({
				argv: ['--target', 'esm'],
				schema: {
					commands: {
						build: {
							default: true,
							options: { '--target [name]': 'Where to build to' },
						},
					},
				},
			});

			expect(state.cmd?.name).toBe('build');
			expect(state.argv.target).toBe('esm');
			expect(state.argv).not.toHaveProperty('esm');
		});

		it('should enforce a required option on the default command', async () => {
			await expect(
				parse({
					argv: [],
					schema: {
						commands: {
							build: { default: true, options: { '--target <name>': 'Where to build to' } },
						},
					},
				})
			).rejects.toThrow(new Error('Missing required options: --target'));
		});

		it('should still resolve the options the root declares', async () => {
			const state = await parse({
				argv: ['--verbose'],
				schema: {
					commands: { build: { default: true } },
					options: { '-v, --verbose': 'Print more output' },
				},
			});

			expect(state.cmd?.name).toBe('build');
			expect(state.argv.verbose).toBe(true);
		});
	});

	describe('nesting', () => {
		it('should dispatch a default subcommand of a matched command', async () => {
			const state = await parse({
				argv: ['build'],
				schema: {
					commands: {
						build: {
							commands: {
								all: { default: true },
								one: {},
							},
						},
					},
				},
			});

			expect(state.cmd?.name).toBe('all');
			expect(state.contexts.map((c) => c.name)).toStrictEqual(['all', 'build', 'global']);
		});

		it('should not dispatch a parent default once a sibling was named', async () => {
			const state = await parse({
				argv: ['build', 'one'],
				schema: {
					commands: {
						build: {
							commands: {
								all: { default: true },
								one: {},
							},
						},
					},
				},
			});

			expect(state.cmd?.name).toBe('one');
		});

		it('should cascade from one default command to the next', async () => {
			const state = await parse({
				argv: [],
				schema: {
					commands: {
						build: {
							commands: { all: { default: true } },
							default: true,
						},
					},
				},
			});

			expect(state.cmd?.name).toBe('all');
			expect(state.contexts.map((c) => c.name)).toStrictEqual(['all', 'build', 'global']);
		});
	});

	describe('declaration errors', () => {
		it('should error if two sibling commands are both default', async () => {
			await expect(
				parse({
					argv: [],
					schema: {
						commands: {
							build: { default: true },
							test: { default: true },
						},
					},
				})
			).rejects.toThrow(
				new Error('Only one default command is allowed: "build" and "test" are both default')
			);
		});

		it('should error if two default subcommands are both default', async () => {
			await expect(
				parse({
					argv: ['build'],
					schema: {
						commands: {
							build: {
								commands: {
									all: { default: true },
									one: { default: true },
								},
							},
						},
					},
				})
			).rejects.toThrow(
				new Error('Only one default command is allowed: "all" and "one" are both default')
			);
		});

		it('should allow a default command in each context', async () => {
			const state = await parse({
				argv: ['build'],
				schema: {
					commands: {
						build: { commands: { all: { default: true } } },
						test: { default: true },
					},
				},
			});

			expect(state.cmd?.name).toBe('all');
		});

		it('should error if default is not a boolean', async () => {
			await expect(
				parse({
					argv: [],
					schema: { commands: { build: { default: 'yes' as any } } },
				})
			).rejects.toThrow(new TypeError('Expected default in "build" command to be a boolean'));
		});
	});

	describe('errors', () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('should fire the beforeError hooks for a default command that throws', async () => {
			const fired: string[] = [];

			const err = await parse({
				argv: [],
				schema: {
					commands: {
						build: {
							args: ['<entry>'],
							default: true,
							hooks: { beforeError: [(e) => void fired.push(`build:${(e as Error).message}`)] },
						},
					},
					hooks: {
						beforeError: [(e) => void fired.push(`global:${(e as Error).message}`)],
					},
				},
			}).catch((e: unknown) => e);

			expect((err as Error).message).toBe('Missing required arguments: <entry>');
			expect(fired).toStrictEqual([
				'build:Missing required arguments: <entry>',
				'global:Missing required arguments: <entry>',
			]);
		});

		it('should render an error thrown by the default command run()', async () => {
			const fired: unknown[] = [];
			const chunks: string[] = [];
			const exitCode = process.exitCode;

			vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
				chunks.push(chunk.toString());
				return true;
			}) as typeof process.stderr.write);

			const result = await main2({
				argv: [],
				schema: {
					commands: {
						build: {
							default: true,
							hooks: { beforeError: [(e) => void fired.push(e)] },
							run() {
								throw new Error('build failed');
							},
						},
					},
				},
			});

			vi.restoreAllMocks();

			expect(result).toBeUndefined();
			expect(chunks.join('')).toBe('Error: build failed\n');
			expect((fired[0] as Error).message).toBe('build failed');
			expect(process.exitCode).toBe(1);

			process.exitCode = exitCode;
		});
	});
});
