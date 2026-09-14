import { type Ansi, createAnsi } from '../../src/ansi/index.js';
import {
	createTerminal,
	type InputStream,
	type OutputStream,
	type Terminal,
} from '../../src/terminal/index.js';
import { createLiveRegion, type LiveRegion } from '../../src/terminal/live.js';

/**
 * What is left of a string once the escape sequences are gone.
 *
 * The carriage return goes too: a repaint leads with `CURSOR_HOME`, which moves
 * the cursor without being an escape sequence, so what is left is what shows.
 *
 * @param text - The written output.
 * @returns The text a person would see.
 */
function strip(text: string): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/\[[\d;?]*[A-Za-z]/g, '').replace(/\r/g, '');
}

export interface FakeStream {
	columns: number | undefined;
	emit(event: string): void;
	/** Only the most recent frame, stripped. */
	readonly frame: string;
	isTTY: boolean;
	on(event: string, listener: (...args: unknown[]) => void): FakeStream;
	/** Everything written, exactly as it was written. */
	readonly output: string;
	removeListener(event: string, listener: (...args: unknown[]) => void): FakeStream;
	/** Everything written, stripped. */
	readonly text: string;
	write(chunk: string): boolean;
	written: string[];
}

/** A stream that records what was written, standing in for stdout. */
export function createStream(opts: { columns?: number; isTTY?: boolean } = {}): FakeStream {
	const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

	const stream: FakeStream = {
		columns: opts.columns ?? 80,
		isTTY: opts.isTTY ?? true,
		written: [],

		get output(): string {
			return stream.written.join('');
		},

		get text(): string {
			return strip(stream.output);
		},

		/**
		 * Frames are separated by the sequences that erase the last one rather than
		 * by newlines -- a repaint is `\r ESC[0J <frame>` -- so splitting the output
		 * on a newline finds the lines of one frame, not the frames themselves.
		 */
		get frame(): string {
			return strip(stream.written.at(-1) ?? '');
		},

		on(event: string, listener: (...args: unknown[]) => void): FakeStream {
			let set = listeners.get(event);
			if (!set) {
				listeners.set(event, (set = new Set()));
			}
			set.add(listener);
			return stream;
		},

		removeListener(event: string, listener: (...args: unknown[]) => void): FakeStream {
			listeners.get(event)?.delete(listener);
			return stream;
		},

		emit(event: string): void {
			// eslint-disable-next-line unicorn/no-useless-spread
			for (const listener of [...(listeners.get(event) ?? [])]) {
				listener();
			}
		},

		write(chunk: string): boolean {
			stream.written.push(chunk);
			return true;
		},
	};

	return stream;
}

export interface FakeInput {
	[Symbol.asyncIterator](): AsyncIterator<string>;
	/** Closes stdin, as a pipe that ran out would. */
	end(): void;
	isTTY: boolean;
	rawMode: boolean;
	/** Sends a chunk to whatever is reading. */
	send(chunk: string): void;
	setRawMode(mode: boolean): FakeInput;
}

/**
 * Stdin as an async iterable of chunks, which is what a prompt reads.
 *
 * Keys are pushed rather than queued up front, so a test can answer one frame
 * and then look at what the next one says.
 *
 * @param opts - Whether it is a terminal.
 * @returns The input.
 */
export function createInput(opts: { isTTY?: boolean } = {}): FakeInput {
	const queue: string[] = [];
	let waiting: ((chunk: IteratorResult<string>) => void) | undefined;
	let ended = false;

	const input: FakeInput = {
		isTTY: opts.isTTY ?? true,
		rawMode: false,

		setRawMode(mode: boolean): FakeInput {
			input.rawMode = mode;
			return input;
		},

		send(chunk: string): void {
			if (waiting) {
				const resolve = waiting;
				waiting = undefined;
				resolve({ done: false, value: chunk });
			} else {
				queue.push(chunk);
			}
		},

		end(): void {
			ended = true;
			if (waiting) {
				const resolve = waiting;
				waiting = undefined;
				resolve({ done: true, value: undefined as never });
			}
		},

		[Symbol.asyncIterator](): AsyncIterator<string> {
			return {
				next(): Promise<IteratorResult<string>> {
					const chunk = queue.shift();
					if (chunk !== undefined) {
						return Promise.resolve({ done: false, value: chunk });
					}
					if (ended) {
						return Promise.resolve({ done: true, value: undefined as never });
					}
					return new Promise((resolve) => {
						waiting = resolve;
					});
				},
			};
		},
	};

	return input;
}

export interface Harness {
	ansi: Ansi;
	region: LiveRegion;
	stdin: FakeInput;
	stdout: FakeStream;
	terminal: Terminal;
}

/**
 * A terminal, a region, and a recording stream, wired together.
 *
 * @param opts - The size, and whether either end is a terminal.
 * @returns The harness.
 */
export function setup(
	opts: { columns?: number; inputTTY?: boolean; isTTY?: boolean } = {}
): Harness {
	const stdout = createStream(opts);
	const stdin = createInput({ isTTY: opts.inputTTY ?? opts.isTTY ?? true });
	const proc = {
		listenerCount: (): number => 0,
		on: (): void => {},
		removeListener: (): void => {},
	};

	const terminal = createTerminal({
		env: {},
		isTTY: opts.isTTY ?? true,
		proc,
		stdin: stdin as unknown as InputStream,
		stdout: stdout as unknown as OutputStream,
	});

	return {
		// level 0, so what a test reads is the text rather than the styling. The
		// styling has tests of its own
		ansi: createAnsi({ level: 0 }),
		region: createLiveRegion({ terminal }),
		stdin,
		stdout,
		terminal,
	};
}

/**
 * Lets pending promises settle, so a prompt can act on what was sent.
 *
 * @param times - How many turns of the microtask queue.
 * @returns Settled.
 */
export function tick(times = 2): Promise<void> {
	let done = Promise.resolve();
	for (let i = 0; i < times; i++) {
		done = done.then(() => {});
	}
	return done;
}
