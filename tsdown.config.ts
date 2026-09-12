import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
	// Every entry here must have a matching subpath in the package's `exports`
	// map, and vice versa; `test/exports.test.ts` asserts they stay in sync.
	entry: {
		'error-handler': './src/error-handler.ts',
		index: './src/index.ts',
		paths: './src/paths.ts',
		updates: './src/updates/index.ts',
	},
	format: ['es'],
	minify: true,
	platform: 'node',
	tsconfig: './tsconfig.build.json',
	// `updates` spawns the worker by reading it off disk relative to its own
	// module URL, so it has to land next to dist/updates.mjs
	copy: [{ from: './src/updates/get-version-worker.js' }],
});

export default config;
