import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The restore path, proven against a real process rather than a fake one.
 *
 * `terminal.test.ts` covers the logic with a recording process object, which is
 * where the branches are. What it cannot show is the part that only exists
 * outside this process: that a signal handler does not swallow the signal, that
 * the cursor sequence actually reaches the stream before the process is gone,
 * and that a closed pipe does not take the CLI down with it. Those need a child.
 *
 * The child runs the built output, since Node resolves the `.js` specifiers this
 * source is written with only after the build rewrites them.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'dist', 'terminal.mjs');

let dir: string;

function fixture(name: string, body: string): string {
	const file = join(dir, name);
	writeFileSync(file, body.replace('<TERMINAL>', JSON.stringify(dist)));
	return file;
}

beforeAll(() => {
	if (!existsSync(dist)) {
		const built = spawnSync('pnpm', ['build'], { cwd: root, encoding: 'utf-8' });
		if (built.status !== 0) {
			throw new Error(`build failed:\n${built.stdout}\n${built.stderr}`);
		}
	}
	dir = mkdtempSync(join(tmpdir(), 'main2-terminal-'));
}, 120000);

/**
 * Runs a child and resolves with everything about how it ended.
 *
 * @param file - The script to run.
 * @param opts - How to run it.
 * @returns What the child wrote and how it died.
 */
function run(
	file: string,
	opts: { signal?: NodeJS.Signals; stdio?: 'pipe' } = {}
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string; stdout: string }> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] });

		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d) => {
			stdout += d;
			// the child says when it is ready to be signalled, so the signal cannot
			// race the handler being installed
			if (opts.signal && stdout.includes('ready')) {
				child.kill(opts.signal);
			}
		});
		child.stderr.on('data', (d) => (stderr += d));

		child.on('error', reject);
		child.on('close', (code, signal) => resolvePromise({ code, signal, stderr, stdout }));
	});
}

const SHOW = '[?25h';
const HIDE = '[?25l';

describe('restoring in a real process', () => {
	it('should show the cursor again on a normal exit', async () => {
		const file = fixture(
			'exit.mjs',
			`
			import { createTerminal } from <TERMINAL>;
			const term = createTerminal({ isTTY: true });
			term.hideCursor();
			process.exitCode = 0;
			`
		);

		const { code, stdout } = await run(file);

		expect(code).to.equal(0);
		expect(stdout).to.equal(HIDE + SHOW);
	});

	// a listener on a signal replaces the default action, so a CLI that hid its
	// cursor would stop dying on Ctrl-C. Restoring must not cost the signal
	it.each<NodeJS.Signals>(['SIGINT', 'SIGTERM'])(
		'should show the cursor again on %s and still die from it',
		async (signal) => {
			const file = fixture(
				`signal-${signal}.mjs`,
				`
				import { createTerminal } from <TERMINAL>;
				const term = createTerminal({ isTTY: true });
				term.hideCursor();
				console.log('ready');
				// nothing else is keeping this alive, so hold it open for the signal
				setInterval(() => {}, 1000);
				`
			);

			const { signal: died, stdout } = await run(file, { signal });

			expect(stdout).to.contain(HIDE);
			expect(stdout).to.contain(SHOW);
			expect(died, 'the signal was swallowed').to.equal(signal);
		},
		30000
	);

	it('should leave raw mode behind on a signal', async () => {
		const file = fixture(
			'raw.mjs',
			`
			import { createTerminal } from <TERMINAL>;
			// reported as it happens, not from an 'exit' handler: a process killed by
			// a signal never emits 'exit', which is the whole reason the signal
			// handlers exist alongside it
			const stdin = {
				isTTY: true,
				setRawMode: (on) => process.stderr.write(on ? 'entered-raw ' : 'left-raw'),
			};
			const term = createTerminal({ isTTY: true, stdin });
			term.setRawMode(true);
			console.log('ready');
			setInterval(() => {}, 1000);
			`
		);

		const { stderr } = await run(file, { signal: 'SIGINT' });

		expect(stderr).to.contain('entered-raw');
		expect(stderr).to.contain('left-raw');
	});

	// `mycli --help | head -1` kills a CLI that did nothing wrong, because an
	// `error` event with no listener is an uncaught exception
	it('should survive the reader closing the pipe', async () => {
		const file = fixture(
			'epipe.mjs',
			`
			import { createTerminal } from <TERMINAL>;
			const term = createTerminal();
			// far more than a pipe buffer, so the write outlives the reader
			for (let i = 0; i < 200000; i++) {
				term.write('line ' + i + '\\n');
			}
			// the EPIPE arrives as an 'error' event, so it lands after this turn of
			// the loop rather than out of the write itself -- which is exactly how a
			// spinner learns to stop between frames
			await new Promise((r) => setTimeout(r, 100));
			process.stderr.write(term.closed ? 'went-quiet' : 'stayed-open');
			process.stderr.write(term.write('more') ? ' still-writing' : ' refused');
			`
		);

		const child = spawn(`${JSON.stringify(process.execPath)} ${JSON.stringify(file)} | head -1`, {
			shell: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stderr = '';
		child.stderr.on('data', (d) => (stderr += d));

		const ended = await new Promise<{ code: number | null }>((res) =>
			child.on('close', (code) => res({ code }))
		);

		expect(stderr).to.not.contain('EPIPE');
		expect(stderr).to.not.contain('Error');
		expect(ended.code, 'the CLI died of a closed pipe').to.equal(0);

		// and once it knows, it stops trying
		expect(stderr).to.contain('went-quiet');
		expect(stderr).to.contain('refused');
	}, 30000);
});
