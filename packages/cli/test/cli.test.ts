import { run, schema, version } from '../src/index.js';
import config from '../tsdown.config.js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

/**
 * Captures whatever is written to the real stdout, the way `main2.test.ts`
 * captures stderr. `run()` writes through the framework, so there is no stream
 * to inject.
 */
function captureStdout() {
	const chunks: string[] = [];
	const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((
		chunk: string | Uint8Array
	) => {
		chunks.push(chunk.toString());
		return true;
	}) as typeof process.stdout.write);

	return {
		restore: () => spy.mockRestore(),
		get text() {
			return chunks.join('');
		},
	};
}

describe('@main2/cli', () => {
	let exitCode: typeof process.exitCode;

	beforeEach(() => {
		exitCode = process.exitCode;
	});

	afterEach(() => {
		// a leaked exit code would fail the entire test run
		process.exitCode = exitCode;
		vi.restoreAllMocks();
	});

	describe('version()', () => {
		it('should report the version from its own manifest', () => {
			expect(version()).toBe(pkg.version);
		});
	});

	describe('schema()', () => {
		it('should name the program after the bin', () => {
			expect(schema().name).toBe('main2');
			expect(Object.keys(pkg.bin)).toEqual(['main2']);
		});

		it('should declare --version', () => {
			expect(schema().options).toHaveProperty('-v, --version');
		});

		it('should declare no commands until there are commands to declare', () => {
			// a command that exists and refuses is worse than one that does not
			// exist yet, because only the second is honest in --help
			expect(schema().commands).toEqual({});
		});
	});

	describe('run()', () => {
		it('should print the version for --version', async () => {
			const out = captureStdout();
			try {
				await run(['--version']);
			} finally {
				out.restore();
			}
			expect(out.text.trim()).toBe(pkg.version);
		});

		it('should print help for --help', async () => {
			const out = captureStdout();
			try {
				await run(['--help']);
			} finally {
				out.restore();
			}
			expect(out.text).toContain('main2');
			expect(out.text).toContain('--version');
		});

		it('should not print the version when it was not asked for', async () => {
			const out = captureStdout();
			try {
				await run([]);
			} finally {
				out.restore();
			}
			expect(out.text).toBe('');
		});
	});

	describe('package wiring', () => {
		it('should build an entry for every exported subpath', () => {
			const entry = config.entry as Record<string, string>;
			for (const [subpath, condition] of Object.entries<any>(pkg.exports)) {
				if (subpath === './package.json') {
					continue;
				}
				const name = subpath === '.' ? 'index' : subpath.slice(2);
				expect(entry, `"${subpath}" has no build entry`).toHaveProperty(name);
				expect(existsSync(resolve(root, entry[name]))).toBe(true);
				expect(condition).toEqual({
					types: `./dist/${name}.d.mts`,
					default: `./dist/${name}.mjs`,
				});
			}
		});

		it('should build an entry for the bin', () => {
			const entry = config.entry as Record<string, string>;
			for (const target of Object.values<string>(pkg.bin)) {
				const name = target.replace(/^\.\/dist\//, '').replace(/\.mjs$/, '');
				expect(entry, `bin "${target}" has no build entry`).toHaveProperty(name);
			}
		});

		it('should give the bin entry a shebang', () => {
			// without it the published bin is not executable by a shell, and
			// nothing else in the build would notice
			const entry = config.entry as Record<string, string>;
			const source = readFileSync(resolve(root, entry.main2), 'utf-8');
			expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
		});

		it('should depend on the runtime rather than bundling it', () => {
			expect(pkg.dependencies).toEqual({ main2: 'workspace:*' });
			expect(config.external).toContain('main2');
		});
	});
});
