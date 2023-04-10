import { parse } from '../../src/parser/parse.js';

describe('error handling', () => {
	test('should error if parse options are invalid', async () => {
		await expect(parse('' as any))
			.rejects.toThrow(new TypeError('Expected parse options to be an object'));

		await expect(parse('foo' as any))
			.rejects.toThrow(new TypeError('Expected parse options to be an object'));

		await expect(parse(null as any))
			.rejects.toThrow(new TypeError('Expected parse options to be an object'));

		await expect(parse(123 as any))
			.rejects.toThrow(new TypeError('Expected parse options to be an object'));
	});

	test('should error if schema is invalid', async () => {
		await expect(parse({ schema: '' as any }))
			.rejects.toThrow(new TypeError('Expected schema to be an object'));

		await expect(parse({ schema: 'foo' as any }))
			.rejects.toThrow(new TypeError('Expected schema to be an object'));

		await expect(parse({ schema: null as any }))
			.rejects.toThrow(new TypeError('Expected schema to be an object'));

		await expect(parse({ schema: 123 as any }))
			.rejects.toThrow(new TypeError('Expected schema to be an object'));
	});

	test('should error if argv is invalid', async () => {
		await expect(parse({ argv: '' as any }))
			.rejects.toThrow(new TypeError('Expected argv to be an array'));

		await expect(parse({ argv: 'foo' as any }))
			.rejects.toThrow(new TypeError('Expected argv to be an array'));

		await expect(parse({ argv: null as any }))
			.rejects.toThrow(new TypeError('Expected argv to be an array'));

		await expect(parse({ argv: 123 as any }))
			.rejects.toThrow(new TypeError('Expected argv to be an array'));
	});

	test('should error if env is invalid', async () => {
		await expect(parse({ env: '' as any }))
			.rejects.toThrow(new TypeError('Expected environment option to be an object'));

		await expect(parse({ env: 'foo' as any }))
			.rejects.toThrow(new TypeError('Expected environment option to be an object'));

		await expect(parse({ env: null as any }))
			.rejects.toThrow(new TypeError('Expected environment option to be an object'));

		await expect(parse({ env: 123 as any }))
			.rejects.toThrow(new TypeError('Expected environment option to be an object'));
	});

	test('should error if schema has an invalid name', async () => {
		await expect(parse({
			schema: {
				name: 123 as any
			}
		})).rejects.toThrow(new TypeError('Expected schema name to be a non-empty string'));
	});
});
