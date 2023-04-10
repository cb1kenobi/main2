import { check } from '../src/updates/index.js';
import { randomUUID } from 'node:crypto';
import { tmp } from '../src/paths.js';

async function generateTmpDir() {
	return tmp('test-main2', randomUUID().slice(0, 8));
}

describe('updates', () => {
	describe('Error Handling', () => {
		it('should error if cache directory is invalid', async () => {
			await expect(check(undefined as any))
				.rejects.toThrowError('Update check options must be an object');
		});
	});

	describe('Check Latest', () => {
		it('should check latest version', async () => {
			const result = await check({
				cacheDir: await generateTmpDir(),
				packageName: 'snooplogg',
				packageVersion: '1.0.0',
				wait: true
			});

			expect(result).toEqual({
				current: '1.0.0',
				latest: '5.1.0'
			});
		});
	});
});
