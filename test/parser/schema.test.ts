import { parse } from '../../src/parser/parse.js';
import { Internal, Schema } from '../../src/types.js';
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
});
