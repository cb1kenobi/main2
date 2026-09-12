import { parse } from '../../src/parser/parse.js';
import { describe, expect, it } from 'vitest';

/**
 * Regression tests for parser correctness fixes. Each block names the defect
 * it guards against; several of these returned a plausible wrong value rather
 * than throwing, so they are easy to reintroduce unnoticed.
 */
describe('regressions', () => {
	describe('short option groups', () => {
		it('should treat an attached value as a value, not more flags', async () => {
			const result = await parse({
				argv: ['-n5'],
				schema: { options: { '-n, --num <n>': { type: 'int' } } },
			});
			expect(result.argv.num).to.equal(5);
		});

		it('should not split a multi-digit negative number into flags', async () => {
			const result = await parse({
				argv: ['--num', '-15'],
				schema: { options: { '-n, --num <n>': { type: 'int' } } },
			});
			expect(result.argv.num).to.equal(-15);
		});

		it('should still expand a group of flags', async () => {
			const result = await parse({
				argv: ['-abc'],
				schema: { options: { '-a': null, '-b': null, '-c': null } },
			});
			expect(result.argv).to.deep.equal({ a: true, b: true, c: true });
		});

		it('should let the last option in a group take the next argument', async () => {
			const result = await parse({
				argv: ['-ab', 'val'],
				schema: { options: { '-a': null, '-b <v>': null } },
			});
			expect(result.argv).to.deep.equal({ a: true, b: 'val' });
		});

		it('should take the rest of the group as the value', async () => {
			const result = await parse({
				argv: ['-abcvalue'],
				schema: { options: { '-a': null, '-b': null, '-c <v>': null } },
			});
			expect(result.argv).to.deep.equal({ a: true, b: true, c: 'value' });
		});

		it('should apply an explicit value to the last flag in a group', async () => {
			const result = await parse({
				argv: ['-ab=false'],
				schema: { options: { '-a': null, '-b': null } },
			});
			expect(result.argv).to.deep.equal({ a: true, b: false });
		});

		it('should resolve a group against a subcommand context', async () => {
			const result = await parse({
				argv: ['build', '-ab'],
				schema: {
					options: { '-a': null },
					commands: { build: { options: { '-b': null } } },
				},
			});
			expect(result.argv).to.deep.equal({ a: true, b: true });
		});
	});

	describe('empty values', () => {
		// `[n]` rather than `<n>` because angle brackets make the option itself
		// required, and a required option rejects an empty value outright
		it('should not coerce an empty value to zero', async () => {
			const result = await parse({
				argv: ['--name='],
				schema: { options: { '--name [n]': { type: 'auto' } } },
			});
			expect(result.argv.name).to.equal('');
		});

		it('should not coerce a blank value to zero', async () => {
			const result = await parse({
				argv: ['--name', ''],
				schema: { options: { '--name [n]': { type: 'auto' } } },
			});
			expect(result.argv.name).to.equal('');
		});
	});

	describe('variadic arguments and later options', () => {
		it('should not drop an option that follows a variadic argument value', async () => {
			const result = await parse({
				argv: ['one', '--foo', 'two'],
				schema: { args: ['[rest...]'], options: { '--foo': null } },
			});
			expect(result.argv.rest).to.deep.equal(['one', 'two']);
			expect(result.argv.foo).to.equal(true);
		});

		it('should not drop an unknown option that follows a variadic argument value', async () => {
			const result = await parse({
				argv: ['one', '--bar'],
				schema: { args: ['[rest...]'] },
			});
			expect(result.argv.rest).to.deep.equal(['one']);
			expect(result.argv.bar).to.equal(true);
		});
	});

	describe('option lookup', () => {
		it('should not resolve a positional value as an option of the same name', async () => {
			const result = await parse({
				argv: ['foo'],
				schema: { args: ['[x]'], options: { '--foo [bar]': null } },
			});
			expect(result.argv.x).to.equal('foo');
		});
	});

	describe('command matching', () => {
		it('should not consume an argument that repeats a command name', async () => {
			const result = await parse({
				argv: ['build', 'build'],
				schema: { commands: { build: { args: ['[x]'] } } },
			});
			expect(result.cmd?.name).to.equal('build');
			expect(result.argv.x).to.equal('build');
		});

		it('should not rematch a nested command name against an outer context', async () => {
			const result = await parse({
				argv: ['a', 'b', 'a'],
				schema: { commands: { a: { commands: { b: { args: ['[x]'] } } } } },
			});
			expect(result.cmd?.name).to.equal('b');
			expect(result.argv.x).to.equal('a');
		});

		it('should still resolve a parent option used after a subcommand', async () => {
			const result = await parse({
				argv: ['build', '--verbose'],
				schema: {
					options: { '--verbose': null },
					commands: { build: {} },
				},
			});
			expect(result.cmd?.name).to.equal('build');
			expect(result.argv.verbose).to.equal(true);
		});

		it('should still resolve a subcommand option used before the subcommand', async () => {
			const result = await parse({
				argv: ['--target', 'x', 'build'],
				schema: { commands: { build: { options: { '--target <t>': null } } } },
			});
			expect(result.cmd?.name).to.equal('build');
			expect(result.argv.target).to.equal('x');
		});
	});

	describe('flag values', () => {
		it('should honor an explicit false on a flag', async () => {
			const result = await parse({
				argv: ['--flag=false'],
				schema: { options: { '--flag': null } },
			});
			expect(result.argv.flag).to.equal(false);
		});

		it('should honor an explicit true on a flag', async () => {
			const result = await parse({
				argv: ['--flag=true'],
				schema: { options: { '--flag': null } },
			});
			expect(result.argv.flag).to.equal(true);
		});

		it('should treat the affirmative form of a negated flag as true', async () => {
			const result = await parse({
				argv: ['--colors'],
				schema: { options: { '--no-colors': null } },
			});
			expect(result.argv.colors).to.equal(true);
		});

		it('should treat an explicit false on a negated flag as a double negative', async () => {
			const result = await parse({
				argv: ['--no-colors=false'],
				schema: { options: { '--no-colors': null } },
			});
			expect(result.argv.colors).to.equal(true);
		});
	});

	describe('choices', () => {
		it('should not validate an option that was never supplied', async () => {
			// `[s]` rather than `<s>` because angle brackets make the option
			// itself required, which is this parser's own convention
			const result = await parse({
				schema: { options: { '--size [s]': { choices: ['sm', 'lg'] } } },
			});
			expect(result.argv.size).to.equal(undefined);
		});

		it('should not validate an optional option that only has a default', async () => {
			const result = await parse({
				schema: { options: { '--size [s]': { choices: ['sm', 'lg'], default: 'sm' } } },
			});
			expect(result.argv.size).to.equal('sm');
		});

		it('should reject an invalid option value', async () => {
			await expect(
				parse({
					argv: ['--size', 'xl'],
					schema: { options: { '--size <s>': { choices: ['sm', 'lg'] } } },
				})
			).rejects.toThrow('Invalid value "xl" for option --size');
		});

		it('should validate every value of a multiple option', async () => {
			await expect(
				parse({
					argv: ['--size', 'sm', '--size', 'xl'],
					schema: { options: { '--size <s>': { choices: ['sm', 'lg'], multiple: true } } },
				})
			).rejects.toThrow('Invalid value "xl" for option --size');
		});

		it('should enforce argument choices', async () => {
			await expect(
				parse({
					argv: ['xl'],
					schema: { args: [{ name: '<size>', choices: ['sm', 'lg'] }] },
				})
			).rejects.toThrow('Invalid value "xl" for argument <size>');
		});

		it('should accept a valid argument value', async () => {
			const result = await parse({
				argv: ['sm'],
				schema: { args: [{ name: '<size>', choices: ['sm', 'lg'] }] },
			});
			expect(result.argv.size).to.equal('sm');
		});
	});

	describe('defaults and environment variables', () => {
		it('should coerce an environment variable to the declared type', async () => {
			const result = await parse({
				env: { N: '42' },
				schema: { options: { '--num <n>': { type: 'int', env: 'N' } } },
			});
			expect(result.argv.num).to.equal(42);
		});

		it('should coerce a string default to the declared type', async () => {
			const result = await parse({
				schema: { options: { '--num <n>': { type: 'int', default: '42' } } },
			});
			expect(result.argv.num).to.equal(42);
		});

		it('should leave a non-string default alone', async () => {
			const result = await parse({
				schema: { options: { '--num <n>': { type: 'int', default: 8080 } } },
			});
			expect(result.argv.num).to.equal(8080);
		});

		it('should wrap an environment fallback for a multiple option', async () => {
			const result = await parse({
				env: { TAG: 'a' },
				schema: { options: { '--tag <t>': { env: 'TAG', multiple: true } } },
			});
			expect(result.argv.tag).to.deep.equal(['a']);
		});

		it('should coerce an argument environment fallback', async () => {
			const result = await parse({
				env: { PORT: '3000' },
				schema: { args: [{ name: '[port]', type: 'int', env: 'PORT' }] },
			});
			expect(result.argv.port).to.equal(3000);
		});

		it('should prefer an environment variable over a default', async () => {
			const result = await parse({
				env: { N: '42' },
				schema: { options: { '--num <n>': { type: 'int', env: 'N', default: 8080 } } },
			});
			expect(result.argv.num).to.equal(42);
		});

		it('should prefer an environment variable over an argument default', async () => {
			const result = await parse({
				env: { PORT: '3000' },
				schema: { args: [{ name: '[port]', type: 'int', env: 'PORT', default: 8080 }] },
			});
			expect(result.argv.port).to.equal(3000);
		});

		it('should reach an environment variable through a flag implicit default', async () => {
			const result = await parse({
				env: { FORCE: 'true' },
				schema: { options: { '--force': { env: 'FORCE' } } },
			});
			expect(result.argv.force).to.equal(true);
		});

		it('should prefer an argv value over an environment variable', async () => {
			const result = await parse({
				argv: ['--num', '7'],
				env: { N: '42' },
				schema: { options: { '--num <n>': { type: 'int', env: 'N', default: 8080 } } },
			});
			expect(result.argv.num).to.equal(7);
		});

		it('should prefer an argv value over a default', async () => {
			const result = await parse({
				argv: ['--num', '7'],
				schema: { options: { '--num <n>': { type: 'int', default: 42 } } },
			});
			expect(result.argv.num).to.equal(7);
		});
	});

	describe('variadic arguments', () => {
		it('should accept <name...>', async () => {
			const result = await parse({
				argv: ['a', 'b'],
				schema: { args: ['<rest...>'] },
			});
			expect(result.argv.rest).to.deep.equal(['a', 'b']);
		});

		it('should accept [name...]', async () => {
			const result = await parse({
				argv: ['a', 'b', 'c'],
				schema: { args: ['<first>', '[rest...]'] },
			});
			expect(result.argv.first).to.equal('a');
			expect(result.argv.rest).to.deep.equal(['b', 'c']);
		});

		it('should still accept [name]...', async () => {
			const result = await parse({
				argv: ['a', 'b', 'c'],
				schema: { args: ['<first>', '[rest]...'] },
			});
			expect(result.argv.first).to.equal('a');
			expect(result.argv.rest).to.deep.equal(['b', 'c']);
		});

		it('should require a variadic declared with angle brackets', async () => {
			await expect(parse({ schema: { args: ['<rest...>'] } })).rejects.toThrow(
				'Missing required arguments: <rest>'
			);
		});
	});

	describe('default data type', () => {
		it('should leave an untyped option value as a string', async () => {
			const result = await parse({
				argv: ['--v', '007'],
				schema: { options: { '--v <x>': null } },
			});
			expect(result.argv.v).to.equal('007');
		});

		it('should leave an untyped argument value as a string', async () => {
			const result = await parse({
				argv: ['007'],
				schema: { args: ['<v>'] },
			});
			expect(result.argv.v).to.equal('007');
		});

		it('should still coerce when a type is declared', async () => {
			const result = await parse({
				argv: ['--v', '007'],
				schema: { options: { '--v <x>': { type: 'int' } } },
			});
			expect(result.argv.v).to.equal(7);
		});
	});
});
