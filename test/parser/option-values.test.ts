import { parse } from '../../src/parser/parse.js';
import { describe, expect, it } from 'vitest';

/**
 * How an option gets its value, and what happens when nothing follows it.
 *
 * The central decision here (M2-13) is that a declared option consumes the
 * next token unless that token resolves to an option something declared. So
 * `--name --verbose` leaves `--verbose` alone, while `--name --undeclared`
 * takes `--undeclared` as the value, because values do legitimately start
 * with a dash and nothing in the schema says otherwise.
 */
describe('option values', () => {
	describe('undeclared options', () => {
		it('should treat an undeclared option with nothing after it as true', async () => {
			const result = await parse({ argv: ['--foo'] });
			expect(result.argv).to.deep.equal({ foo: true });
			expect(result._).to.deep.equal([]);
		});

		it('should take an attached value', async () => {
			const result = await parse({ argv: ['--foo=bar'] });
			expect(result.argv).to.deep.equal({ foo: 'bar' });
		});

		it('should take the next token as its value', async () => {
			const result = await parse({ argv: ['--foo', 'bar'] });
			expect(result.argv).to.deep.equal({ foo: 'bar' });
		});

		it('should guess the data type of its value', async () => {
			const result = await parse({ argv: ['--age', '20'] });
			expect(result.argv).to.deep.equal({ age: 20 });
		});

		it('should not take another option-like token as its value', async () => {
			const result = await parse({ argv: ['--foo', '--bar'] });
			expect(result.argv).to.deep.equal({ foo: true, bar: true });
		});

		it('should camelCase the destination', async () => {
			const result = await parse({ argv: ['--dry-run'] });
			expect(result.argv).to.deep.equal({ dryRun: true });
		});

		it('should not read no- as negation', async () => {
			const result = await parse({ argv: ['--no-color'] });
			expect(result.argv).to.deep.equal({ noColor: true });
		});

		it('should accept an undeclared short option', async () => {
			const result = await parse({ argv: ['-x', '1'] });
			expect(result.argv).to.deep.equal({ x: 1 });
		});

		it('should let the last occurrence win', async () => {
			const result = await parse({ argv: ['--foo', 'a', '--foo', 'b'] });
			expect(result.argv).to.deep.equal({ foo: 'b' });
		});

		it('should leave an unresolved short group alone', async () => {
			const result = await parse({
				argv: ['-abc'],
				settings: { allowUnexpectedArguments: true },
			});
			expect(result.argv).to.deep.equal({});
			expect(result._).to.deep.equal(['-abc']);
		});

		it('should not take a matched command as its value', async () => {
			const result = await parse({
				argv: ['--foo', 'build'],
				schema: { commands: { build: {} } },
			});
			expect(result.cmd?.name).to.equal('build');
			expect(result.argv).to.deep.equal({ foo: true });
		});

		it('should throw when allowUnknownOptions is false', async () => {
			await expect(
				parse({ argv: ['--foo'], settings: { allowUnknownOptions: false } })
			).rejects.toThrow('Unknown option "--foo"');
		});
	});

	describe('missing values', () => {
		it('should throw when a required option has no value', async () => {
			await expect(
				parse({ argv: ['--name'], schema: { options: { '--name <value>': null } } })
			).rejects.toThrow('Missing value for required option --name');
		});

		it('should throw when a required option is given an empty value', async () => {
			await expect(
				parse({ argv: ['--name='], schema: { options: { '--name <value>': null } } })
			).rejects.toThrow('Missing value for required option --name');
		});

		it('should give an optional string option an empty string', async () => {
			const result = await parse({
				argv: ['--name'],
				schema: { options: { '--name [value]': null } },
			});
			expect(result.argv).to.deep.equal({ name: '' });
		});

		it('should coerce the missing value to the declared type', async () => {
			const result = await parse({
				argv: ['--age'],
				schema: { options: { '--age [value]': { type: 'number' } } },
			});
			expect(result.argv).to.deep.equal({ age: 0 });
		});

		it('should still reject a value of the wrong type', async () => {
			await expect(
				parse({
					argv: ['--age', 'hello'],
					schema: { options: { '--age <value>': { type: 'number' } } },
				})
			).rejects.toThrow('Invalid number: hello');
		});
	});

	describe('a token that looks like an option', () => {
		it('should not consume a declared option', async () => {
			const result = await parse({
				argv: ['--name', '--age', '20'],
				schema: {
					options: { '--name [value]': null, '--age <value>': { type: 'number' } },
				},
			});
			expect(result.argv).to.deep.equal({ name: '', age: 20 });
		});

		it('should throw when a required option is followed by a declared option', async () => {
			await expect(
				parse({
					argv: ['--name', '--age', '20'],
					schema: {
						options: { '--name <value>': null, '--age <value>': { type: 'number' } },
					},
				})
			).rejects.toThrow('Missing value for required option --name');
		});

		it('should not consume a declared flag', async () => {
			const result = await parse({
				argv: ['--name', '--silent'],
				schema: { options: { '--name [value]': null, '--silent': null } },
			});
			expect(result.argv).to.deep.equal({ name: '', silent: true });
		});

		it('should not consume a declared short option', async () => {
			const result = await parse({
				argv: ['--name', '-s'],
				schema: { options: { '--name [value]': null, '-s, --silent': null } },
			});
			expect(result.argv).to.deep.equal({ name: '', silent: true });
		});

		it('should not consume a resolvable short option group', async () => {
			const result = await parse({
				argv: ['--name', '-ab'],
				schema: { options: { '--name [value]': null, '-a': null, '-b': null } },
			});
			expect(result.argv).to.deep.equal({ name: '', a: true, b: true });
		});

		it('should not consume the terminator', async () => {
			const result = await parse({
				argv: ['--name', '--', 'rest'],
				schema: { options: { '--name [value]': null } },
				settings: { allowExtraArguments: true },
			});
			expect(result.argv).to.deep.equal({ name: '' });
			expect(result._).to.deep.equal(['rest']);
		});

		it('should consume an undeclared option', async () => {
			const result = await parse({
				argv: ['--name', '--age', '20'],
				schema: {
					args: [{ name: 'args', multiple: true }],
					options: { '--name [value]': null },
				},
			});
			expect(result.argv).to.deep.equal({ name: '--age', args: ['20'] });
		});

		it('should keep the whole token when it carries an attached value', async () => {
			const result = await parse({
				argv: ['--name', '--age=20'],
				schema: { options: { '--name [value]': null } },
			});
			expect(result.argv).to.deep.equal({ name: '--age=20' });
		});

		it('should let an explicit empty value opt out of consuming it', async () => {
			const result = await parse({
				argv: ['--name=', '--age', '20'],
				schema: { options: { '--name [value]': null } },
			});
			expect(result.argv).to.deep.equal({ name: '', age: 20 });
		});

		it('should let an attached value be an option-like string', async () => {
			const result = await parse({
				argv: ['--name=--verbose'],
				schema: { options: { '--name <value>': null, '--verbose': null } },
			});
			expect(result.argv).to.deep.equal({ name: '--verbose', verbose: false });
		});

		it('should still take a negative number as a value', async () => {
			const result = await parse({
				argv: ['--num', '-15'],
				schema: { options: { '--num <n>': { type: 'int' } } },
			});
			expect(result.argv).to.deep.equal({ num: -15 });
		});
	});
});
