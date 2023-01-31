/* eslint-disable @typescript-eslint/no-explicit-any */

import { fileURLToPath } from 'node:url';
import { parse } from '../../src/parser/index.js';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('commands', () => {
	describe('Error Handling', () => {
		it('should error if commands definition is invalid', async () => {
			await expect(parse({
				schema: {
					commands: 123 as any
				}
			})).to.eventually.be.rejectedWith(TypeError, 'Expected commands to be one or more paths or an object');

			await expect(parse({
				schema: {
					commands: null as any
				}
			})).to.eventually.be.rejectedWith(TypeError, 'Expected commands to be one or more paths or an object');
		});

		it('should error if command has an invalid name', async () => {
			await expect(parse({
				schema: {
					commands: {
						foo: {
							name: 123 as any
						}
					}
				}
			})).to.eventually.be.rejectedWith(TypeError, 'Expected command name to be a non-empty string');
		});

		it('should error if run function is invalid', async () => {
			await expect(parse({
				schema: {
					commands: {
						foo: {
							run: 'foo' as any
						}
					}
				}
			})).to.eventually.be.rejectedWith(TypeError, 'Invalid run function in "foo" command');
		});
	});

	describe('string', () => {
		it('should error if path is an empty string', async () => {
			await expect(parse({
				schema: {
					commands: ''
				}
			})).to.eventually.be.rejectedWith(TypeError, 'Expected commands to be one or more paths or an object');
		});

		it('should error if path is unsupported file type', async () => {
			await expect(parse({
				schema: {
					commands: 'unsupported.txt'
				}
			})).to.eventually.be.rejectedWith(Error, 'Unsupported command module "unsupported.txt"');
		});

		it('should load a command by file path', async () => {
			await parse({
				schema: {
					commands: path.join(__dirname, 'fixtures/simple/foo.js')
				}
			});
		});

		it('should load commands by directory path', async () => {
			await parse({
				schema: {
					commands: path.join(__dirname, 'fixtures/simple')
				}
			});
		});
	});

	describe('array', () => {
		it('should not error if array is empty', async () => {
			await parse({
				schema: {
					commands: []
				}
			});
		});

		it('should error if path is an empty string', async () => {
			await expect(parse({
				schema: {
					commands: [ '', 'foo' ]
				}
			})).to.eventually.be.rejectedWith(TypeError, 'Expected commands to be one or more paths or an object');
		});

		it('should error if path is unsupported file type', async () => {
			await expect(parse({
				schema: {
					commands: [ 'unsupported.txt' ]
				}
			})).to.eventually.be.rejectedWith(Error, 'Unsupported command module "unsupported.txt"');
		});

		it('should load a command by file path', async () => {
			await parse({
				schema: {
					commands: [
						path.join(__dirname, 'fixtures/simple/bar.js'),
						path.join(__dirname, 'fixtures/simple/foo.js')
					]
				}
			});
		});

		it('should load commands by directory path', async () => {
			await parse({
				schema: {
					commands: [
						path.join(__dirname, 'fixtures/simple')
					]
				}
			});
		});

		it('should handle array of objects', async () => {
			const result = await parse({
				argv: [ 'foo' ],
				schema: {
					commands: [
						{ name: 'foo' },
						{ name: 'bar' }
					]
				}
			});

			expect(result.contexts[0].name).to.equal('foo');
		});

		it('should error if name is invalid', async () => {
			await expect(parse({
				argv: [ 'foo' ],
				schema: {
					commands: [
						{ name: undefined as any }
					]
				}
			})).to.eventually.be.rejectedWith(TypeError, 'Expected command name to be a non-empty string');

			await expect(parse({
				argv: [ 'foo' ],
				schema: {
					commands: [
						{ name: 123 as any }
					]
				}
			})).to.eventually.be.rejectedWith(TypeError, 'Expected command name to be a non-empty string');
		});
	});

	describe('object', () => {
		it('should load multiple commands with file paths and objects', async () => {
			await parse({
				schema: {
					commands: {
						bar: path.join(__dirname, 'fixtures/simple/bar.js'),
						foo: path.join(__dirname, 'fixtures/simple/foo.js'),
						baz: {}
					}
				}
			});
		});

		it('should detect a command', async () => {
			const result = await parse({
				argv: [ 'baz' ],
				schema: {
					commands: {
						bar: path.join(__dirname, 'fixtures/simple/bar.js'),
						foo: path.join(__dirname, 'fixtures/simple/foo.js'),
						baz: {}
					}
				}
			});

			expect(result.contexts[0].name).to.equal('baz');
		});

		it('should detect a nested command', async () => {
			const result = await parse({
				argv: [ 'foo', 'bar' ],
				schema: {
					commands: {
						foo: {
							commands: {
								bar: {
									//
								}
							}
						}
					}
				}
			});

			expect(result.contexts[0].name).to.equal('bar');
			expect(result.contexts[1].name).to.equal('foo');
		});

		it('should lazy load command module as .js file path', async () => {
			const result = await parse({
				argv: [ 'foo' ],
				schema: {
					commands: {
						foo: path.join(__dirname, 'fixtures/simple/foo.js')
					}
				}
			});

			expect(result.cmd).to.be.ok;
			if (result.cmd !== undefined) {
				expect(result.cmd.name).to.equal('foo');
				expect(result.cmd.desc).to.equal('foo!');
			}
		});

		it('should lazy load command module as .mjs file path', async () => {
			const result = await parse({
				argv: [ 'foo' ],
				schema: {
					commands: {
						foo: path.join(__dirname, 'fixtures/esm/foo.mjs')
					}
				}
			});

			expect(result.cmd).to.be.ok;
			if (result.cmd !== undefined) {
				expect(result.cmd.name).to.equal('foo');
				expect(result.cmd.desc).to.equal('foo!');
			}
		});

		it('should lazy load command module as .cjs file path', async () => {
			const result = await parse({
				argv: [ 'foo' ],
				schema: {
					commands: {
						foo: path.join(__dirname, 'fixtures/esm/foo.cjs')
					}
				}
			});

			expect(result.cmd).to.be.ok;
			if (result.cmd !== undefined) {
				expect(result.cmd.name).to.equal('foo');
				expect(result.cmd.desc).to.equal('foo!');
			}
		});

		it('should lazy load a command module as object', async () => {
			const result = await parse({
				argv: [ 'foo' ],
				schema: {
					commands: {
						foo: {
							desc: 'this should be overwritten',
							path: path.join(__dirname, 'fixtures/simple/foo.js')
						}
					}
				}
			});

			expect(result.cmd).to.be.ok;
			if (result.cmd !== undefined) {
				expect(result.cmd.name).to.equal('foo');
				expect(result.cmd.desc).to.equal('foo!');
			}
		});

		it('should error if command module does not exist', async () => {
			await expect(parse({
				argv: [ 'foo' ],
				schema: {
					commands: {
						foo: 'does_not_exist.js'
					}
				}
			})).to.eventually.be.rejectedWith(Error, 'Command module not found: does_not_exist.js');
		});

		it('should error if command module has invalid syntax', async () => {
			await expect(parse({
				argv: [ 'foo' ],
				schema: {
					commands: {
						foo: path.join(__dirname, 'fixtures/bad-syntax.js'),
					}
				}
			})).to.eventually.be.rejectedWith(Error, 'Failed to load command module: Unexpected end of input');
		});

		it('should error if command module does not export default', async () => {
			await expect(parse({
				argv: [ 'foo' ],
				schema: {
					commands: {
						foo: path.join(__dirname, 'fixtures/no-default.js'),
					}
				}
			})).to.eventually.be.rejectedWith(TypeError, /^Command module default export is not a valid command object/);
		});

		it('should error if command module exports invalid definition', async () => {
			await expect(parse({
				argv: [ 'foo' ],
				schema: {
					commands: {
						foo: path.join(__dirname, 'fixtures/invalid.js'),
					}
				}
			})).to.eventually.be.rejectedWith(TypeError, /^Command module default export is not a valid command object:/);
		});

		it('should error if commands definition is invalid', async () => {
			await expect(parse({
				schema: {
					commands: {
						foo: ''
					}
				}
			})).to.eventually.be.rejectedWith(Error, 'Expected commands to be one or more paths or an object');
		});
	});

	describe('aliases', () => {
		it('should detect a command with single alias', async () => {
			const result = await parse({
				argv: [ 'bar' ],
				schema: {
					commands: {
						foo: {
							alias: 'bar'
						}
					}
				}
			});

			expect(result.contexts[0].name).to.equal('foo');
		});

		it('should detect a command with multiple aliases', async () => {
			const result = await parse({
				argv: [ 'baz' ],
				schema: {
					commands: {
						foo: {
							alias: [ 'bar', 'baz', '' ]
						}
					}
				}
			});

			expect(result.contexts[0].name).to.equal('foo');
		});

		it('should error if alias is invalid', async () => {
			await expect(parse({
				schema: {
					commands: {
						foo: {
							alias: 123 as any
						}
					}
				}
			})).to.eventually.be.rejectedWith(TypeError, 'Expected command alias to be a string or list of strings');

			await expect(parse({
				schema: {
					commands: {
						foo: {
							alias: [ 123 as any ]
						}
					}
				}
			})).to.eventually.be.rejectedWith(TypeError, 'Expected command alias to be a string or list of strings');
		});
	});

	describe.skip('version', () => {
		it('should wire up version option and command', async () => {
			// TODO
		});
	});
});
