/* eslint-disable @typescript-eslint/no-explicit-any */

import { parse } from '../../src/parser/index.js';

describe('error handling', () => {
	it('should error if parse options are invalid', async () => {
		await expect(parse('' as any))
			.to.eventually.be.rejectedWith(TypeError, 'Expected parse options to be an object');

		await expect(parse('foo' as any))
			.to.eventually.be.rejectedWith(TypeError, 'Expected parse options to be an object');

		await expect(parse(null as any))
			.to.eventually.be.rejectedWith(TypeError, 'Expected parse options to be an object');

		await expect(parse(123 as any))
			.to.eventually.be.rejectedWith(TypeError, 'Expected parse options to be an object');
	});

	it('should error if schema is invalid', async () => {
		await expect(parse({ schema: '' as any }))
			.to.eventually.be.rejectedWith(TypeError, 'Expected schema to be an object');

		await expect(parse({ schema: 'foo' as any }))
			.to.eventually.be.rejectedWith(TypeError, 'Expected schema to be an object');

		await expect(parse({ schema: null as any }))
			.to.eventually.be.rejectedWith(TypeError, 'Expected schema to be an object');

		await expect(parse({ schema: 123 as any }))
			.to.eventually.be.rejectedWith(TypeError, 'Expected schema to be an object');
	});

	it('should error if argv is invalid', async () => {
		await expect(parse({ argv: '' as any }))
			.to.eventually.be.rejectedWith(TypeError, 'Expected argv to be an array');

		await expect(parse({ argv: 'foo' as any }))
			.to.eventually.be.rejectedWith(TypeError, 'Expected argv to be an array');

		await expect(parse({ argv: null as any }))
			.to.eventually.be.rejectedWith(TypeError, 'Expected argv to be an array');

		await expect(parse({ argv: 123 as any }))
			.to.eventually.be.rejectedWith(TypeError, 'Expected argv to be an array');
	});

	it('should error if env is invalid', async () => {
		await expect(parse({ env: '' as any }))
			.to.eventually.be.rejectedWith(TypeError, 'Expected environment option to be an object');

		await expect(parse({ env: 'foo' as any }))
			.to.eventually.be.rejectedWith(TypeError, 'Expected environment option to be an object');

		await expect(parse({ env: null as any }))
			.to.eventually.be.rejectedWith(TypeError, 'Expected environment option to be an object');

		await expect(parse({ env: 123 as any }))
			.to.eventually.be.rejectedWith(TypeError, 'Expected environment option to be an object');
	});

	it('should error if schema has an invalid name', async () => {
		await expect(parse({
			schema: {
				name: 123 as any
			}
		})).to.eventually.be.rejectedWith(TypeError, 'Expected schema name to be a non-empty string');
	});
});
