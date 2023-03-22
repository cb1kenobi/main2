import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			reporter: ['html', 'lcov', 'text']
		},
		environment: 'node',
		globals: true,
		include: [
			'test/**/*.test.ts'
		],
		watch: false
	}
});
