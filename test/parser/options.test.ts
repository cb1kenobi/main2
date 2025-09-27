import { describe, it, expect } from 'vitest';
import { Internal, Option } from '../../src/types.js';
import { parse } from '../../src/parser/parse.js';

describe('options', () => {
	describe('Error Handling', () => {
		it('should error if options is invalid', async () => {
			await expect(parse({
				schema: {
					options: 123 as any
				}
			})).rejects.toThrow(new TypeError('Expected options to be an object'));

			await expect(parse({
				schema: {
					options: null as any
				}
			})).rejects.toThrow(new TypeError('Expected options to be an object'));
		});

		it('should error if option is invalid', async () => {
			await expect(parse({
				schema: {
					options: {
						foo: 123 as any
					}
				}
			})).rejects.toThrow(new TypeError('Expected option to be an object'));
		});

		it('should error if format is invalid', async () => {
			await expect(parse({
				schema: {
					options: {
						'': null
					}
				}
			})).rejects.toThrow(new TypeError('Expected option format to be a non-empty string'));

			await expect(parse({
				schema: {
					options: {
						'--f(': null
					}
				}
			})).rejects.toThrow(new TypeError('Invalid option format: --f('));

			await expect(parse({
				schema: {
					options: {
						'--f"': null
					}
				}
			})).rejects.toThrow(new TypeError('Invalid option format: --f"'));

			await expect(parse({
				schema: {
					options: {
						'--f\'': null
					}
				}
			})).rejects.toThrow(new TypeError('Invalid option format: --f\''));
		});

		it('should error if option transform is invalid', async () => {
			await expect(parse({
				schema: {
					options: {
						'--foo': {
							transform: 'bar' as any
						}
					}
				}
			})).rejects.toThrow('Expected option transform function to be a function');
		});

		it('should error if option env is invalid', async () => {
			await expect(parse({
				schema: {
					options: {
						'--foo': {
							env: 123 as any
						}
					}
				}
			})).rejects.toThrow(new TypeError('Expected option environment variable to be a string or array of strings'));
		});
	});

	describe('format', () => {
		it('should use long option for the name', async () => {
			const result = await parse({
				schema: {
					options: {
						'--force': null
					}
				}
			});
			const { options } = result.contexts[0][Internal];
			const force = options.get('force');
			expect(force).to.deep.equal({
				default: false,
				format: '--force',
				name:   'force',
				type:   'bool'
			});
			expect(force?.[Internal].short.has('--force')).to.equal(false);
			expect(force?.[Internal].long.has('--force')).to.equal(true);
			expect(force?.[Internal].label).to.equal('--force');
		});

		it('should parse short and long options', async () => {
			const result = await parse({
				schema: {
					options: {
						'-f, --force | --forced': 'Use the force'
					}
				}
			});
			const { options } = result.contexts[0][Internal];
			const force = options.get('force');
			expect(force).to.deep.equal({
				default: false,
				desc:   'Use the force',
				format: '-f, --force | --forced',
				name:   'force',
				type:   'bool'
			});
			expect(force?.[Internal].short.has('-f')).to.equal(true);
			expect(force?.[Internal].short.has('--force')).to.equal(false);
			expect(force?.[Internal].long.has('-f')).to.equal(false);
			expect(force?.[Internal].long.has('--force')).to.equal(true);
			expect(force?.[Internal].long.has('--forced')).to.equal(true);
			expect(force?.[Internal].label).to.equal('--force');
		});

		it('should parse short option with name in object', async () => {
			const result = await parse({
				schema: {
					options: {
						'-f': {
							name: 'force'
						}
					}
				}
			});
			const { options } = result.contexts[0][Internal];
			const force = options.get('force');
			expect(force).to.deep.equal({
				default: false,
				format: '-f',
				name:   'force',
				type:   'bool'
			});
			expect(force?.[Internal].short.has('-f')).to.equal(true);
			expect(force?.[Internal].short.has('--force')).to.equal(false);
			expect(force?.[Internal].long.has('-f')).to.equal(false);
			expect(force?.[Internal].long.has('--force')).to.equal(false);
		});

		it('should parse name from format', async () => {
			const result = await parse({
				schema: {
					options: {
						'force': {}
					}
				}
			});
			const { options } = result.contexts[0][Internal];
			const force = options.get('force');
			expect(force).to.deep.equal({
				default: false,
				format: 'force',
				name:   'force',
				type:   'bool'
			});
			expect(force?.[Internal].long.has('--force')).to.equal(true);
		});

		it('should parse short and long option with required value', async () => {
			const result = await parse({
				argv: ['--directory', '/foo'],
				schema: {
					options: {
						'-d, --directory <path>': {}
					}
				}
			});
			const { options } = result.contexts[0][Internal];
			const dir = options.get('directory');
			expect(dir).to.deep.equal({
				format:   '-d, --directory <path>',
				hint:     'path',
				name:     'directory',
				required: true,
				type:     'auto'
			});
			expect(dir?.[Internal].short.has('-d')).to.equal(true);
			expect(dir?.[Internal].long.has('--directory')).to.equal(true);
		});

		it('should parse short and long option with option value', async () => {
			const result = await parse({
				schema: {
					options: {
						'-d, --directory [path]': {}
					}
				}
			});
			const { options } = result.contexts[0][Internal];
			const dir = options.get('directory');
			expect(dir).to.deep.equal({
				format: '-d, --directory [path]',
				hint:   'path',
				name:   'directory',
				type:   'auto'
			});
			expect(dir?.[Internal].short.has('-d')).to.equal(true);
			expect(dir?.[Internal].long.has('--directory')).to.equal(true);
		});

		it('should parse ignore dupes', async () => {
			const result = await parse({
				schema: {
					options: {
						'--foo --bar --foo --bar': {}
					}
				}
			});
			const { options } = result.contexts[0][Internal];
			const dir = options.get('foo');
			expect(dir).to.deep.equal({
				default: false,
				format: '--foo --bar --foo --bar',
				name:   'foo',
				type:   'bool'
			});
			expect(dir?.[Internal].long.has('--foo')).to.equal(true);
			expect(dir?.[Internal].long.has('--bar')).to.equal(true);
		});
	});

	describe('multiple', () => {
		it('should parse multiple option value', async () => {
			const result = await parse({
				argv: ['--include', 'foo'],
				schema: {
					options: {
						'--include <file>': {
							multiple: true
						}
					}
				}
			});
			const { options } = result.contexts[0][Internal];
			const inc = options.get('include');
			expect(inc).to.deep.equal({
				format: '--include <file>',
				hint: 'file',
				multiple: true,
				name: 'include',
				required: true,
				type: 'auto'
			});
			expect(inc?.[Internal].long.has('--include')).to.equal(true);
		});
	});

	describe('negate', () => {
		it('should parse negated option', async () => {
			const result = await parse({
				schema: {
					options: {
						'--no-colors': {}
					}
				}
			});
			const { options } = result.contexts[0][Internal];
			const colors = options.get('colors');
			expect(colors).to.deep.equal({
				default: true,
				format: '--no-colors',
				name: 'colors',
				negate: true,
				type: 'bool'
			});
			expect(colors?.[Internal].long.has('--no-colors')).to.equal(true);
		});

		it('should parse auto negate option', async () => {
			let result = await parse({
				argv: [
					'--no-colors'
				],
				schema: {
					options: {
						'--no-colors': {}
					}
				}
			});
			expect(result.argv.colors).to.equal(false);

			result = await parse({
				schema: {
					options: {
						'--no-colors': {}
					}
				}
			});
			expect(result.argv.colors).to.equal(true);
		});

		it('should parse negated option', async () => {
			let result = await parse({
				argv: [
					'--no-colors'
				],
				schema: {
					options: {
						colors: {
							negate: true
						}
					}
				}
			});
			expect(result.argv.colors).to.equal(false);

			result = await parse({
				schema: {
					options: {
						colors: {
							negate: false
						}
					}
				}
			});
			expect(result.argv.colors).to.equal(false);
		});
	});

	describe('type', () => {
		it('should error if option definition type is invalid', async () => {
			await expect(parse({
				schema: {
					options: {
						'--foo': {
							type: 'bar'
						}
					}
				}
			})).rejects.toThrow('Option "foo" has unsupported data type "bar"');
		});

		it('should parse option with auto type', async () => {
			const schema = {
				options: {
					'--foo <bar>': {}
				}
			};

			let result = await parse({
				argv: ['--foo', 'true'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: true
			});

			result = await parse({
				argv: ['--foo', 'false'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: false
			});

			const now = new Date();

			result = await parse({
				argv: ['--foo', now.toISOString()],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: now
			});

			const nowFormatted = `${
				now.getFullYear()
			}-${
				String(now.getMonth() + 1).padStart(2, '0')
			}-${
				String(now.getDate()).padStart(2, '0')
			}`;
			const now2 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

			result = await parse({
				argv: ['--foo', nowFormatted],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: now2
			});

			result = await parse({
				argv: ['--foo', '123'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: 123
			});

			result = await parse({
				argv: ['--foo', '3.14'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: 3.14
			});

			result = await parse({
				argv: ['--foo', '{"bar": "baz"}'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: { bar: 'baz' }
			});

			result = await parse({
				argv: ['--foo', 'bar'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: 'bar'
			});
		});

		it('should parse long option as boolean', async () => {
			const schema = {
				options: {
					'--foo <bar>': {
						type: 'bool'
					}
				}
			};

			let result = await parse({
				argv: ['--foo', 'true'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: true
			});

			result = await parse({
				argv: ['--foo', 'baz'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: true
			});

			result = await parse({
				argv: ['--foo', 'false'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: false
			});
		});

		it('should parse short option as boolean', async () => {
			const schema = {
				options: {
					'-f <bar>': {
						type: 'bool'
					}
				}
			};

			let result = await parse({
				argv: ['-f', 'true'],
				schema
			});
			expect(result.argv).to.deep.equal({
				f: true
			});

			result = await parse({
				argv: ['-f', 'baz'],
				schema
			});
			expect(result.argv).to.deep.equal({
				f: true
			});

			result = await parse({
				argv: ['-f', 'false'],
				schema
			});
			expect(result.argv).to.deep.equal({
				f: false
			});
		});

		it('should parse option as date', async () => {
			const schema = {
				options: {
					'--foo <bar>': {
						type: 'date'
					}
				}
			};

			const now = new Date();
			const nowFormatted = `${
				now.getFullYear()
			}-${
				String(now.getMonth() + 1).padStart(2, '0')
			}-${
				String(now.getDate()).padStart(2, '0')
			}`;
			const now2 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

			let result = await parse({
				argv: ['--foo', `${now.getTime()}`],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: now
			});

			result = await parse({
				argv: ['--foo', now.toISOString()],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: now
			});

			result = await parse({
				argv: ['--foo', nowFormatted],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: now2
			});

			await expect(parse({
				argv: ['--foo', '9999-99-99'],
				schema
			})).rejects.toThrow('Invalid date: "9999-99-99"');
		});

		it('should parse option as integer', async () => {
			const schema = {
				options: {
					'--foo <bar>': {
						type: 'int'
					}
				}
			};

			const result = await parse({
				argv: ['--foo', '123'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: 123
			});

			await expect(parse({
				argv: ['--foo', '1.23'],
				schema
			})).rejects.toThrow('Invalid integer: 1.23');

			await expect(parse({
				argv: ['--foo', 'foo'],
				schema
			})).rejects.toThrow('Invalid integer: foo');
		});

		it('should parse option as json', async () => {
			const schema = {
				options: {
					'--foo <bar>': {
						type: 'json'
					}
				}
			};

			const result = await parse({
				argv: ['--foo', '{"bar":"baz"}'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: { bar: 'baz' }
			});

			await expect(parse({
				argv: ['--foo', '{{{'],
				schema
			})).rejects.toThrow(/^Invalid JSON:/);
		});

		it('should parse option as number', async () => {
			const schema = {
				options: {
					'--foo <bar>': {
						type: 'number'
					}
				}
			};

			let result = await parse({
				argv: ['--foo', '123'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: 123
			});

			result = await parse({
				argv: ['--foo', '3.14'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: 3.14
			});

			await expect(parse({
				argv: ['--foo', 'foo'],
				schema
			})).rejects.toThrow('Invalid number: foo');
		});

		it('should parse option as yes/no boolean', async () => {
			const schema = {
				options: {
					'--foo <bar>': {
						type: 'yesno'
					}
				}
			};

			let result = await parse({
				argv: ['--foo', 'yes'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: true
			});

			result = await parse({
				argv: ['--foo', 'no'],
				schema
			});
			expect(result.argv).to.deep.equal({
				foo: false
			});

			await expect(parse({
				argv: ['--foo', 'foo'],
				schema
			})).rejects.toThrow('Value must be "yes" or "no"');
		});
	});

	describe('type (flag)', () => {
		it('should error if short option definition type is invalid', async () => {
			await expect(parse({
				schema: {
					options: {
						'--foo': {
							type: 'bar'
						}
					}
				}
			})).rejects.toThrow('Option "foo" has unsupported data type "bar"');

			await expect(parse({
				schema: {
					options: {
						'--foo': {
							type: 'int'
						}
					}
				}
			})).rejects.toThrow('Option flags must have type of \'auto\', \'bool\', \'count\', or \'yesno\'');
		});

		it('should parse flag with auto type', async () => {
			const result = await parse({
				argv: ['--foo'],
				schema: {
					options: {
						'--foo': {
							type: 'auto'
						}
					}
				}
			});
			expect(result.argv).to.deep.equal({
				foo: true
			});
		});

		it('should parse long option as boolean', async () => {
			const result = await parse({
				argv: ['--foo'],
				schema: {
					options: {
						'--foo': {
							type: 'bool'
						}
					}
				}
			});
			expect(result.argv).to.deep.equal({
				foo: true
			});
		});

		it('should parse long option as yes/no boolean', async () => {
			const result = await parse({
				argv: ['--foo'],
				schema: {
					options: {
						'--foo': {
							type: 'yesno'
						}
					}
				}
			});
			expect(result.argv).to.deep.equal({
				foo: true
			});
		});

		it('should error if option is not a flag and has type \'count\'', async () => {
			await expect(parse({
				schema: {
					options: {
						'--foo <value>': {
							type: 'count'
						}
					}
				}
			})).rejects.toThrow('Only flags can be of type "count"');
		});

		it('should count multiple instances of a flag', async () => {
			const result = await parse({
				argv: [
					'-vvvvv'
				],
				schema: {
					options: {
						'-v, --verbose': {
							type: 'count'
						}
					}
				}
			});
			expect(result.argv.verbose).to.equal(5);
		});
	});

	describe('aliases', () => {
		it('should register a single alias \'--bar\'', async () => {
			const result = await parse({
				schema: {
					options: {
						'--foo': {
							alias: '--bar'
						}
					}
				}
			});
			const { options } = result.contexts[0][Internal];
			const inc = options.get('foo');
			expect(inc).to.deep.equal({
				alias: '--bar',
				default: false,
				format: '--foo',
				name: 'foo',
				type: 'bool'
			});
			expect(inc?.[Internal].long.has('--foo')).to.equal(true);
			expect(inc?.[Internal].long.has('--bar')).to.equal(true);
		});

		it('should register a single alias \'bar\'', async () => {
			const result = await parse({
				schema: {
					options: {
						'--foo': {
							alias: 'bar'
						}
					}
				}
			});
			const { options } = result.contexts[0][Internal];
			const inc = options.get('foo');
			expect(inc).to.deep.equal({
				alias: 'bar',
				default: false,
				format: '--foo',
				name: 'foo',
				type: 'bool'
			});
			expect(inc?.[Internal].long.has('--foo')).to.equal(true);
			expect(inc?.[Internal].long.has('--bar')).to.equal(true);
		});

		it('should register multiple aliases as a string', async () => {
			const result = await parse({
				schema: {
					options: {
						'--foo': {
							alias: '--bar, --baz'
						}
					}
				}
			});
			const { options } = result.contexts[0][Internal];
			const inc = options.get('foo');
			expect(inc).to.deep.equal({
				alias: '--bar, --baz',
				default: false,
				format: '--foo',
				name: 'foo',
				type: 'bool'
			});
			expect(inc?.[Internal].long.has('--foo')).to.equal(true);
			expect(inc?.[Internal].long.has('--bar')).to.equal(true);
			expect(inc?.[Internal].long.has('--baz')).to.equal(true);
		});

		it('should register multiple aliases as an array', async () => {
			const result = await parse({
				schema: {
					options: {
						'--foo': {
							alias: ['-f', '--bar', '--baz']
						}
					}
				}
			});
			const { options } = result.contexts[0][Internal];
			const inc = options.get('foo');
			expect(inc).to.deep.equal({
				alias: ['-f', '--bar', '--baz'],
				default: false,
				format: '--foo',
				name: 'foo',
				type: 'bool'
			});
			expect(inc?.[Internal].short.has('-f')).to.equal(true);
			expect(inc?.[Internal].long.has('--foo')).to.equal(true);
			expect(inc?.[Internal].long.has('--bar')).to.equal(true);
			expect(inc?.[Internal].long.has('--baz')).to.equal(true);
		});

		it('should error if alias is invalid', async () => {
			await expect(parse({
				schema: {
					options: {
						'--foo': {
							alias: 123 as any
						}
					}
				}
			})).rejects.toThrow(new TypeError('Expected option alias to be a string or list of strings'));

			await expect(parse({
				schema: {
					options: {
						'--foo': {
							alias: [null, 123] as any
						}
					}
				}
			})).rejects.toThrow(new TypeError('Expected option alias to be a string or list of strings'));

			await expect(parse({
				schema: {
					options: {
						'--foo': {
							alias: '-'
						}
					}
				}
			})).rejects.toThrow(new TypeError('Invalid option alias "-"'));
		});
	});

	describe('parse', () => {
		it('should error if option is unknown', async () => {
			await expect(parse({
				argv: ['--foo']
			})).rejects.toThrow('Unknown option "--foo"');
		});

		it('should parse a flag using long name', async () => {
			const result = await parse({
				argv: [
					'--foo'
				],
				schema: {
					options: {
						'--foo': {}
					}
				}
			});

			expect(result.argv.foo).to.equal(true);
		});

		it('should default flags to false', async () => {
			const result = await parse({
				schema: {
					options: {
						'--foo': {}
					}
				}
			});

			expect(result.argv.foo).to.equal(false);
		});

		it('should parse a short flag', async () => {
			const result = await parse({
				argv: [
					'-f'
				],
				schema: {
					options: {
						'-f, --foo': {}
					}
				}
			});

			expect(result.argv.foo).to.equal(true);
		});

		it('should parse a short flag with name', async () => {
			const schema = {
				options: {
					'-f': { name: 'foo' }
				}
			};
			const result = await parse({
				argv: [
					'-f'
				],
				schema
			});

			expect(result.argv.foo).to.equal(true);

			await expect(parse({
				argv: ['--foo'],
				schema
			})).rejects.toThrow('Unknown option "--foo"');
		});

		it('should parse several short flags', async () => {
			const result = await parse({
				argv: [
					'-fgh'
				],
				schema: {
					options: {
						'-f, --foo': {},
						'-g, --bar': {},
						'-h, --baz': {}
					}
				}
			});

			expect(result.argv.foo).to.equal(true);
			expect(result.argv.bar).to.equal(true);
			expect(result.argv.baz).to.equal(true);
		});

		it('should parse an option with arg value', async () => {
			const result = await parse({
				argv: ['--output-dir', 'dist'],
				schema: {
					options: {
						'--output-dir <path>': {}
					}
				}
			});
			expect(result.argv.outputDir).to.equal('dist');
		});

		it('should parse an option with = value', async () => {
			const result = await parse({
				argv: ['--output-dir=dist'],
				schema: {
					options: {
						'--output-dir <path>': {}
					}
				}
			});
			expect(result.argv.outputDir).to.equal('dist');
		});

		it('should parse an option with immediate quoted value', async () => {
			const schema = {
				options: {
					'-m, --message <msg>': {}
				}
			};

			let result = await parse({
				argv: ['--message"hello"'],
				schema
			});
			expect(result.argv.message).to.equal('hello');

			result = await parse({
				argv: ['--message\'hello\''],
				schema
			});
			expect(result.argv.message).to.equal('hello');

			result = await parse({
				argv: ['-m"hello"'],
				schema
			});
			expect(result.argv.message).to.equal('hello');

			result = await parse({
				argv: ['-m\'hello\''],
				schema
			});
			expect(result.argv.message).to.equal('hello');
		});

		it('should parse several short flags followed by a value', async () => {
			const result = await parse({
				argv: [
					'-fgh',
					'a.txt'
				],
				schema: {
					options: {
						'-f, --foo': {},
						'-g, --bar': {},
						'-h, --baz <file>': {}
					}
				}
			});

			expect(result.argv.foo).to.equal(true);
			expect(result.argv.bar).to.equal(true);
			expect(result.argv.baz).to.equal('a.txt');
		});

		it('should parse several short flags followed by an equals value', async () => {
			const result = await parse({
				argv: [
					'-fgh=a.txt'
				],
				schema: {
					options: {
						'-f, --foo': {},
						'-g, --bar': {},
						'-h, --baz <file>': {}
					}
				}
			});

			expect(result.argv.foo).to.equal(true);
			expect(result.argv.bar).to.equal(true);
			expect(result.argv.baz).to.equal('a.txt');
		});

		it('should error if a required option is missing', async () => {
			await expect(parse({
				argv: [],
				schema: {
					options: {
						'--foo <bar>': ''
					}
				}
			})).rejects.toThrow('Missing required options: --foo');
		});

		it('should error if invalid option choice', async () => {
			await expect(parse({
				argv: ['--foo', 'baz'],
				schema: {
					options: {
						'--foo <bar>': {
							choices: ['bar', 'wiz']
						}
					}
				}
			})).rejects.toThrow('Invalid value "baz" for option --foo');
		});

		it('should use default if required option is not specified', async () => {
			const result = await parse({
				schema: {
					options: {
						'--output <path>': {
							default: 'dist'
						}
					}
				}
			});
			expect(result.argv.output).to.equal('dist');
		});

		it('should try to default to a single env variable', async () => {
			const result = await parse({
				env: {
					OUTPUT: 'dist'
				},
				schema: {
					options: {
						'--output [path]': {
							env: 'OUTPUT'
						}
					}
				}
			});

			expect(result.argv.output).to.equal('dist');
		});

		it('should try to default to multiple env variables', async () => {
			const result = await parse({
				env: {
					OUTPUT: 'dist'
				},
				schema: {
					options: {
						'--output <path>': {
							env: ['DIST', 'OUTPUT']
						}
					}
				}
			});

			expect(result.argv.output).to.equal('dist');
		});

		it('should overwrite multiple instances of same option if not multiple', async () => {
			const result = await parse({
				argv: [
					'-f', 'a.txt',
					'-f', 'b.txt',
					'--file', 'c.txt'
				],
				schema: {
					options: {
						'-f, --file <path>': {}
					}
				}
			});

			expect(result.argv.file).to.equal('c.txt');
		});

		it('should parse multiple instances of same option', async () => {
			const result = await parse({
				argv: [
					'-f', 'a.txt',
					'-f', 'b.txt',
					'--file', 'c.txt'
				],
				schema: {
					options: {
						'-f, --file <path>': {
							multiple: true
						}
					}
				}
			});

			expect(result.argv.file).to.deep.equal([
				'a.txt',
				'b.txt',
				'c.txt'
			]);
		});
	});

	describe('transform', () => {
		it('should fire argument callback on parse', async () => {
			const result = await parse({
				argv: ['--foo', 'a'],
				schema: {
					options: {
						'--foo <bar>': {
							foo: 'BC',
							async transform(value) {
								if (typeof value === 'string') {
									return value.toUpperCase() + (this as Option).foo;
								}
							}
						}
					}
				}
			});
			expect(result.argv).to.deep.equal({
				foo: 'ABC'
			});
		});

		it('should not transform transformed values', async () => {
			const now = Date.now();
			const result = await parse({
				argv: ['--foo', 'a'],
				schema: {
					options: {
						'--foo <bar>': {
							type: 'date',
							async transform(value) {
								if (typeof value === 'string') {
									return now;
								}
							}
						}
					}
				}
			});
			expect(result.argv).to.deep.equal({
				foo: now
			});
		});
	});
});
