import { initArg } from '../../src/parser/argument/init-arg.js';
import { initCommand } from '../../src/parser/command/init-command.js';
import { loadCommand } from '../../src/parser/command/load-command.js';
import { parse } from '../../src/parser/parse.js';
import { Command, CommandHookData, Internal, Schema } from '../../src/types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the schema used by most of these tests. It is a function rather than
 * a constant so each test gets a pristine declaration, and so the expected
 * shape can be written twice without one copy drifting from the other.
 */
function makeSchema() {
	return {
		args: [{ name: '[first]' }, { name: '<second>' }],
		options: {
			'-v, --verbose': null,
			'--no-color': {},
			'--tag [t]': { multiple: true },
		},
		commands: {
			'build, @b': {
				args: ['<entry>', '[rest...]'],
				options: { '--target [name]': { choices: ['esm', 'cjs'] } },
				commands: {
					'!secret': { args: [{ name: '[x]' }] },
				},
			},
		},
	};
}

/**
 * Freezes an object graph so any write to it throws instead of passing
 * unnoticed.
 */
function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const v of Object.values(value)) {
			deepFreeze(v);
		}
	}
	return value;
}

/**
 * Collects every object reachable from the declaration that carries an own
 * symbol property, which is how the `Internal` state would show up if it were
 * still being attached to the caller's objects.
 */
function withSymbols(value: unknown, seen = new Set<unknown>(), found: unknown[] = []): unknown[] {
	if (!value || typeof value !== 'object' || seen.has(value)) {
		return found;
	}
	seen.add(value);
	if (Object.getOwnPropertySymbols(value).length) {
		found.push(value);
	}
	for (const v of Object.values(value)) {
		withSymbols(v, seen, found);
	}
	return found;
}

describe('schema', () => {
	describe('the caller keeps their schema', () => {
		it('should not name an anonymous schema "global"', async () => {
			const schema = {};
			await parse({ argv: [], schema });
			expect(schema).to.deep.equal({});
			expect(Object.getOwnPropertySymbols(schema)).to.have.lengthOf(0);
		});

		it('should still name the root context "global"', async () => {
			const { contexts } = await parse({ argv: [], schema: {} });
			expect(contexts[0].name).to.equal('global');
		});

		it('should leave commands, args, and options exactly as declared', async () => {
			const schema = makeSchema();

			await parse({
				argv: ['build', 'main.js', 'a', 'b', '--target', 'esm', '--verbose'],
				schema,
			});

			// no parsed name, no flipped `hidden`, no normalized args, no
			// negation folded into an option, no inline args lifted onto `args`
			expect(schema).to.deep.equal(makeSchema());
			expect('name' in schema.commands['build, @b']).to.equal(false);
			expect('hidden' in schema.commands['build, @b']).to.equal(false);
			expect('hidden' in schema.commands['build, @b'].commands['!secret']).to.equal(false);
			expect(schema.commands['build, @b'].args).to.deep.equal(['<entry>', '[rest...]']);
			expect(schema.options['--no-color']).to.deep.equal({});
			// `[first]` precedes a required argument, so the parser promotes its
			// own copy of it and leaves this one alone
			expect(schema.args[0]).to.deep.equal({ name: '[first]' });
		});

		it('should not attach the Internal symbol to anything the caller owns', async () => {
			const schema = makeSchema();
			await parse({ argv: ['build', 'main.js'], schema });
			expect(withSymbols(schema)).to.deep.equal([]);
		});

		it('should not write to the schema when parsing throws', async () => {
			const schema = { commands: { 'build, @b': { args: ['<entry>'] } } };
			await expect(parse({ argv: ['build'], schema })).rejects.toThrow(
				'Missing required arguments: <entry>'
			);
			expect(schema).to.deep.equal({ commands: { 'build, @b': { args: ['<entry>'] } } });
		});
	});

	describe('reusing a schema', () => {
		it('should produce identical results when parsed twice', async () => {
			const schema = makeSchema();
			const argv = ['build', 'main.js', 'a', 'b', '--target', 'esm', '--verbose', '--tag', 'x'];

			const first = await parse({ argv: [...argv], schema });
			const second = await parse({ argv: [...argv], schema });

			expect(second.argv).to.deep.equal(first.argv);
			expect(second._).to.deep.equal(first._);
			expect(second.contexts.map((c) => c.name)).to.deep.equal(first.contexts.map((c) => c.name));
			expect(second.cmd?.name).to.equal(first.cmd?.name);
		});

		it('should parse the same schema with different argv', async () => {
			const schema = makeSchema();

			const first = await parse({ argv: ['one', 'two', '--tag', 'x'], schema });
			expect(first.argv).to.deep.equal({
				color: true,
				first: 'one',
				second: 'two',
				tag: ['x'],
				verbose: false,
			});

			const second = await parse({
				argv: ['build', 'main.js', 'rest', '--target', 'cjs', '--no-color'],
				schema,
			});
			expect(second.cmd?.name).to.equal('build');
			expect(second.argv).to.deep.equal({
				color: false,
				entry: 'main.js',
				rest: ['rest'],
				target: 'cjs',
				verbose: false,
			});
		});

		it('should hand back a fresh context chain each time', async () => {
			const schema = makeSchema();
			const first = await parse({ argv: ['build', 'main.js'], schema });
			const second = await parse({ argv: ['build', 'main.js'], schema });
			expect(second.contexts[0]).to.not.equal(first.contexts[0]);
			expect(second.contexts[0].name).to.equal(first.contexts[0].name);
		});

		it('should resolve an alias the same way on a second parse', async () => {
			const schema = makeSchema();
			for (const name of ['build', 'b']) {
				const { contexts } = await parse({ argv: [name, 'main.js'], schema });
				expect(contexts[0].name).to.equal('build');
			}
		});
	});

	describe('a frozen schema', () => {
		it('should parse a frozen schema', async () => {
			const schema: Schema = Object.freeze({ options: { '-v, --verbose': null } });
			const { argv } = await parse({ argv: ['-v'], schema });
			expect(argv.verbose).to.equal(true);
		});

		it('should parse a deeply frozen schema', async () => {
			const schema = deepFreeze(makeSchema());
			const { argv, cmd } = await parse({
				argv: ['build', 'main.js', 'a', '--target', 'esm', '--no-color'],
				schema,
			});
			expect(cmd?.name).to.equal('build');
			expect(argv).to.deep.equal({
				color: false,
				entry: 'main.js',
				rest: ['a'],
				target: 'esm',
				verbose: false,
			});
		});

		it('should parse a deeply frozen schema twice', async () => {
			const schema = deepFreeze(makeSchema());
			const first = await parse({ argv: ['build', 'main.js'], schema });
			const second = await parse({ argv: ['build', 'main.js'], schema });
			expect(second.argv).to.deep.equal(first.argv);
		});

		it('should parse a frozen schema with a frozen name', async () => {
			const schema = deepFreeze({ name: 'myapp', args: [{ name: '<file>' }] });
			const { argv, contexts } = await parse({ argv: ['x'], schema });
			expect(contexts[0].name).to.equal('myapp');
			expect(argv.file).to.equal('x');
		});
	});

	describe('values the parser hands back', () => {
		it('should not let a consumer push into a declared default', async () => {
			const schema = {
				options: { '--tag [t]': { default: ['a'], multiple: true } },
			};

			const first = await parse({ argv: [], schema });
			expect(first.argv.tag).to.deep.equal(['a']);
			(first.argv.tag as string[]).push('b');

			const second = await parse({ argv: [], schema });
			expect(second.argv.tag).to.deep.equal(['a']);
			expect(schema.options['--tag [t]'].default).to.deep.equal(['a']);
		});

		it('should not let a hook append to the declared hook lists', async () => {
			const init = () => {};
			const schema = {
				commands: {
					build: {
						alias: ['b'],
						hooks: {
							init: [
								({ cmd }: { cmd: Command }) => {
									cmd.hooks?.init?.push(init);
									(cmd.alias as string[]).push('bld');
								},
							],
						},
					},
				},
			};

			const { contexts } = await parse({ argv: ['build'], schema });
			expect([...contexts[0][Internal].aliases]).to.deep.equal(['b']);
			expect(schema.commands.build.alias).to.deep.equal(['b']);
			expect(schema.commands.build.hooks.init).to.have.lengthOf(1);

			// and the second parse still sees one hook and one alias
			await parse({ argv: ['build'], schema });
			expect(schema.commands.build.hooks.init).to.have.lengthOf(1);
			expect(schema.commands.build.alias).to.deep.equal(['b']);
		});

		it('should fall back to the option key when format is nullish', async () => {
			// only reachable from JavaScript, where `format` can be left null
			const schema = { options: { '-v, --verbose': { format: null } } } as unknown as Schema;
			const { argv } = await parse({ argv: ['-v'], schema });
			expect(argv.verbose).to.equal(true);
			expect(schema.options?.['-v, --verbose']).to.deep.equal({ format: null });
		});

		it('should not let an init hook append to declared choices', async () => {
			const schema = {
				commands: {
					build: {
						options: { '--target [name]': { choices: ['esm'] } },
						hooks: {
							init: [
								({ options }) => {
									options.get('target')?.choices?.push('cjs');
								},
							],
						},
					},
				},
			};

			// the hook edits the parser's copy of `choices`, so `cjs` is accepted
			// — but the declaration keeps the one value it declared, and the
			// second parse starts from that same one value again
			const first = await parse({ argv: ['build', '--target', 'cjs'], schema });
			expect(first.argv.target).to.equal('cjs');
			expect(schema.commands.build.options['--target [name]'].choices).to.deep.equal(['esm']);

			const second = await parse({ argv: ['build', '--target', 'cjs'], schema });
			expect(second.argv.target).to.equal('cjs');
			expect(schema.commands.build.options['--target [name]'].choices).to.deep.equal(['esm']);
		});
	});

	describe('a lazily loaded command', () => {
		it('should not write to the module object', async () => {
			// the module default exports a deeply frozen object, so merging the
			// placeholder into it in place would throw
			const schema = {
				commands: { 'build, !bld': { path: path.join(__dirname, 'fixtures/frozen/build.js') } },
			};

			for (let i = 0; i < 2; i++) {
				const { contexts } = await parse({ argv: ['bld', 'main.js'], schema });
				expect(contexts[0].name).to.equal('build');
				expect(contexts[0].desc).to.equal('build it');
				expect(contexts[0].hidden).to.equal(true);
				expect([...contexts[0][Internal].aliases]).to.deep.equal(['bld']);
				expect(contexts[0][Internal].args.map((a) => a.name)).to.deep.equal(['entry']);
				expect(contexts[0][Internal].options.get('target')).to.not.equal(undefined);
			}

			expect(schema).to.deep.equal({
				commands: { 'build, !bld': { path: path.join(__dirname, 'fixtures/frozen/build.js') } },
			});
		});

		it('should load a directory of commands twice', async () => {
			const schema = { commands: path.join(__dirname, 'fixtures/frozen') };
			for (let i = 0; i < 2; i++) {
				const { contexts } = await parse({ argv: ['build', 'main.js'], schema });
				expect(contexts[0].name).to.equal('build');
				expect(contexts[0].desc).to.equal('build it');
			}
		});

		it('should not write to a command package module object', async () => {
			const schema = { commands: path.join(__dirname, 'fixtures/frozen-pkg') };
			for (let i = 0; i < 2; i++) {
				const { contexts } = await parse({ argv: ['frozen-pkg'], schema });
				expect(contexts[0].name).to.equal('frozen-pkg');
				expect(contexts[0].desc).to.equal('from the package');
			}
		});
	});

	describe('a command is fixed once it is initialized', () => {
		it('should throw rather than drop a write to args, commands, or options', async () => {
			// `cmd.args`, `cmd.commands`, and `cmd.options` are the declaration as
			// it was given; the parser reads `cmd[Internal]`. Writing one used to
			// be silently discarded by a Proxy trap.
			for (const prop of ['args', 'commands', 'options'] as const) {
				const schema = {
					commands: {
						build: {
							args: ['[entry]'],
							commands: { nested: {} },
							options: { '--target [name]': null },
							hooks: {
								init: [
									({ cmd }: CommandHookData) => {
										(cmd as Record<string, unknown>)[prop] = {};
									},
								],
							},
						},
					},
				};

				await expect(parse({ argv: ['build'], schema })).rejects.toThrow(
					new Error(
						`Cannot set "${prop}" on the initialized "build" command: the parser reads cmd[Internal].${prop}, so change that instead`
					)
				);
			}
		});

		it('should throw rather than drop a delete of args, commands, or options', async () => {
			for (const prop of ['args', 'commands', 'options'] as const) {
				const schema = {
					commands: {
						build: {
							args: ['[entry]'],
							commands: { nested: {} },
							options: { '--target [name]': null },
							hooks: {
								init: [
									({ cmd }: CommandHookData) => {
										delete (cmd as Record<string, unknown>)[prop];
									},
								],
							},
						},
					},
				};

				await expect(parse({ argv: ['build'], schema })).rejects.toThrow(TypeError);
			}
		});

		it('should throw rather than drop a write into a container', async () => {
			// the containers are frozen too, so reaching past the property and
			// adding an entry is just as loud as replacing it
			const schema = {
				commands: {
					build: {
						options: { '--target [name]': null },
						hooks: {
							init: [
								({ cmd }: CommandHookData) => {
									(cmd.options as Record<string, unknown>)['--extra [v]'] = null;
								},
							],
						},
					},
				},
			};

			await expect(parse({ argv: ['build'], schema })).rejects.toThrow(TypeError);
		});

		it('should still define the containers a declaration left out', async () => {
			// a command that declares no options has nothing to echo back, but the
			// write is refused all the same rather than landing on a stray property
			const schema = {
				commands: {
					build: {
						hooks: {
							init: [
								({ cmd }: CommandHookData) => {
									cmd.options = { '--extra [v]': null };
								},
							],
						},
					},
				},
			};

			await expect(parse({ argv: ['build'], schema })).rejects.toThrow(
				/Cannot set "options" on the initialized "build" command/
			);

			// ...and the absent containers stay absent, so a command still reads
			// back as what was declared
			const { contexts } = await parse({ argv: ['build'], schema: { commands: { build: {} } } });
			expect(Object.keys(contexts[0])).to.not.include('options');
			expect(Object.keys(contexts[0])).to.not.include('args');
			expect(Object.keys(contexts[0])).to.not.include('commands');
		});

		it('should let an init hook add an option through the registry', async () => {
			const schema = {
				commands: {
					build: {
						hooks: {
							init: [
								async ({ options }: CommandHookData) => {
									await options.add({ format: '--extra [v]' });
								},
							],
						},
					},
				},
			};

			for (let i = 0; i < 2; i++) {
				const { argv } = await parse({ argv: ['build', '--extra', 'yes'], schema });
				expect(argv.extra).to.equal('yes');
			}
		});

		it('should let an init hook add an argument through the registry', async () => {
			const schema = {
				commands: {
					build: {
						hooks: {
							init: [
								({ args }: CommandHookData) => {
									args.push(initArg('[entry]'));
								},
							],
						},
					},
				},
			};

			const { argv } = await parse({ argv: ['build', 'main.js'], schema });
			expect(argv.entry).to.equal('main.js');
		});

		it('should let an init hook add a command through the registry', async () => {
			const schema = {
				commands: {
					build: {
						hooks: {
							init: [
								async ({ commands }: CommandHookData) => {
									commands.add(await initCommand({ name: 'nested' }));
								},
							],
						},
					},
				},
			};

			const { contexts } = await parse({ argv: ['build', 'nested'], schema });
			expect(contexts.map((c) => c.name)).to.deep.equal(['nested', 'build', 'global']);
		});

		it('should keep the declaration echo out of sync with the registry', async () => {
			// this is the reason the containers are read-only: what a command
			// echoes back is what was declared, not what the parser resolved
			const schema = {
				commands: {
					'build <entry>': {
						options: { '-t, --target [name]': null },
						hooks: {
							init: [
								async ({ options }: CommandHookData) => {
									await options.add({ format: '--extra [v]' });
								},
							],
						},
					},
				},
			};

			const { contexts } = await parse({ argv: ['build', 'main.js'], schema });
			const build = contexts[0];

			expect(build.args).to.deep.equal(['<entry>']);
			expect(build.options).to.deep.equal({ '-t, --target [name]': null });
			expect(build[Internal].args.map((a) => a.name)).to.deep.equal(['entry']);
			expect([...build[Internal].options.keys()]).to.deep.equal(['target', 'extra']);
		});

		it('should initialize the loaded flag instead of leaning on undefined', async () => {
			const { contexts } = await parse({
				argv: [],
				schema: { commands: { build: { path: path.join(__dirname, 'fixtures/frozen/build.js') } } },
			});

			const build = contexts[0][Internal].commands.find('build');
			expect(build?.[Internal].loaded).to.equal(false);

			await loadCommand(build!);
			expect(build?.[Internal].loaded).to.equal(true);
		});

		it('should let an init hook edit an option in place', async () => {
			// options and arguments are plain objects, so nothing is derived from
			// them after init and a write to one is simply what the parser reads
			const schema = {
				commands: {
					build: {
						options: { '--target [name]': { choices: ['esm'] } },
						hooks: {
							init: [
								({ options }: CommandHookData) => {
									const target = options.get('target');
									target!.choices = ['esm', 'cjs'];
									target!.default = 'esm';
								},
							],
						},
					},
				},
			};

			const { argv } = await parse({ argv: ['build', '--target', 'cjs'], schema });
			expect(argv.target).to.equal('cjs');

			const { argv: argv2 } = await parse({ argv: ['build'], schema });
			expect(argv2.target).to.equal('esm');
		});
	});
});
