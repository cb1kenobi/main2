import { defineConfig, type ViteUserConfig } from 'vitest/config';

/**
 * One vitest run over every package, rather than one vitest per package driven
 * by turbo.
 *
 * Turbo is the right tool for `build` and `type-check`: they are expensive, they
 * have a dependency order, and their output is cacheable. It is the wrong tool
 * for `test` here. Fanning tests out through it costs everything that makes a
 * test runner usable -- a path argument goes to every package at once and fails
 * in whichever has no such file, `--watch` starts two watchers with no TTY
 * between them, the strict environment drops `DEBUG` and `FORCE_COLOR`, and a
 * cached run replays fifteen hundred lines of output that look like a fresh one.
 * The whole suite runs in under a second, so there was never much cache to win.
 *
 * Each package keeps its own config; this only gathers them.
 */
const config: ViteUserConfig = defineConfig({
	test: {
		projects: ['packages/*'],
	},
});

export default config;
