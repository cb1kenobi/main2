import { parse } from '../../src/parser/index.js';

describe('hooks', () => {
	it('should error if hooks are invalid', async () => {
		await expect(parse({
			schema: {
				hooks: 123 as any
			}
		})).to.eventually.be.rejectedWith(TypeError, 'Expected hooks to be an object of hook names and callbacks');

		await expect(parse({
			schema: {
				hooks: {
					beforeParse: 123 as any
				}
			}
		})).to.eventually.be.rejectedWith(TypeError, 'Expected "beforeParse" hook to be an array of functions');

		await expect(parse({
			schema: {
				hooks: {
					beforeParse: [ 123 as any ]
				}
			}
		})).to.eventually.be.rejectedWith(TypeError, 'Expected "beforeParse" hook to be an array of functions');
	});

	it('should fire hooks during parsing', async () => {
		const result = {
			beforeParseCalled: false,
			afterParseCalled: false
		};

		await parse({
			schema: {
				hooks: {
					beforeParse: [
						() => {
							result.beforeParseCalled = true;
						}
					],
					afterParse: [
						() => {
							result.afterParseCalled = true;
						}
					]
				}
			}
		});

		expect(result).to.deep.equal({
			beforeParseCalled: true,
			afterParseCalled: true
		});
	});

	// TODO beforeError
});
