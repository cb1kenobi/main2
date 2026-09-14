import { Computed, Watcher } from './graph.js';

/**
 * Runs the queued work. A scheduler decides *when* to call this; the proposal
 * deliberately has no opinion, and neither does this module.
 */
export type Flush = () => void;

/**
 * Asks for `flush` to be called later. Called only on the transition from
 * nothing-queued to something-queued, so a burst of writes asks once.
 */
export type Scheduler = (flush: Flush) => void;

/**
 * The default: a microtask, so a synchronous run of writes settles into one
 * pass before anything else observes the result.
 *
 * The renderer replaces this with the frame loop, which is the point of the
 * seam -- a terminal cannot absorb a repaint per microtask.
 */
const microtask: Scheduler = (fn) => queueMicrotask(fn);

let scheduler: Scheduler = microtask;

/**
 * Replaces the scheduler that decides when pending effects run.
 *
 * @param next - The new scheduler, or `undefined` to restore the microtask one.
 * @returns The scheduler that was in place, so a caller can put it back.
 */
export function setScheduler(next: Scheduler | undefined): Scheduler {
	const previous = scheduler;
	scheduler = next ?? microtask;
	return previous;
}

let queued = false;

const watcher: Watcher = new Watcher(() => {
	// the watcher fires at most once until re-armed, so this guard is belt and
	// braces rather than the mechanism
	if (!queued) {
		queued = true;
		scheduler(flush);
	}
});

/**
 * Runs every effect that has gone stale, then re-arms the watcher.
 *
 * Reading a pending computed is what re-runs its body; the value is discarded,
 * because an effect is run for what it does rather than for what it returns.
 *
 * An effect that throws does not take the rest of them with it, and does not
 * wedge the graph: every pending effect is attempted and the watcher is re-armed
 * either way. Leaving it disarmed would mean one bad effect silently ending all
 * future reactivity, which is a far worse failure than a loud one. The first
 * error is rethrown once everything else has run.
 */
export function flush(): void {
	queued = false;
	const pending = watcher.getPending();
	let thrown: { error: unknown } | undefined;

	try {
		for (const computed of pending) {
			try {
				computed.get();
			} catch (err) {
				thrown ??= { error: err };
			}
		}
	} finally {
		watcher.watch();
	}

	if (thrown) {
		throw thrown.error;
	}
}

/**
 * Runs `fn` now, and again whenever a signal it read has changed.
 *
 * An effect is a `Computed` nobody reads for its value, held live by a
 * `Watcher`. That is the composition the proposal intends: the graph decides
 * *what* is stale and the scheduler decides *when* to act on it.
 *
 * `fn` may return a cleanup function, which runs before each re-run and once
 * more when the effect is disposed -- the way a subscription is meant to be
 * taken down.
 *
 * @param fn - What to run. May return a cleanup.
 * @returns Disposes the effect, running any pending cleanup.
 */
export function effect(fn: () => void | (() => void)): () => void {
	let cleanup: (() => void) | undefined;
	let disposed = false;

	const computed = new Computed<void>(() => {
		// cleared before it is called, so a cleanup that throws is not left behind
		// to be called a second time on the next run
		const previous = cleanup;
		cleanup = undefined;
		previous?.();
		cleanup = fn() ?? undefined;
	});

	watcher.watch(computed);

	// run once now rather than waiting for a change: an effect describes the
	// present, not only the future
	computed.get();

	return () => {
		if (disposed) {
			return;
		}
		disposed = true;
		watcher.unwatch(computed);
		const previous = cleanup;
		cleanup = undefined;
		previous?.();
	};
}
