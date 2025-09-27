import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		allowOnly: true,
		benchmark: {
			include: ['benchmark/**/*.bench.ts']
		},
		coverage: {
			include: ['src/**/*.ts'],
			reporter: ['html', 'lcov', 'text']
		},
		environment: 'node',
		globals: false,
		include: ['test/**/*.test.ts'],
		pool: 'threads',
		reporters: ['verbose'],
		silent: false,
		testTimeout: 10000,
		watch: false
	}
});
