import { Computed, effect, flush, setScheduler, State } from '../../src/signals/index.js';
import { afterEach, describe, expect, it } from 'vitest';

/** Lets the default microtask scheduler run. */
function tick(): Promise<void> {
	return Promise.resolve();
}

/**
 * Replaces the scheduler with one that queues nothing, so a test drives the
 * flush by hand and asserts on exact timing rather than on a microtask landing.
 */
function manualScheduler() {
	const pending: (() => void)[] = [];
	const previous = setScheduler((fn) => pending.push(fn));
	return {
		get queued() {
			return pending.length;
		},
		restore: () => setScheduler(previous),
		run() {
			const queued = pending.splice(0, pending.length);
			for (const fn of queued) {
				fn();
			}
		},
	};
}

describe('effect', () => {
	afterEach(() => {
		setScheduler(undefined);
	});

	it('should run immediately', () => {
		let runs = 0;
		const stop = effect(() => {
			runs++;
		});
		expect(runs).toBe(1);
		stop();
	});

	it('should re-run when a signal it read changes', async () => {
		const s = new State(0);
		const seen: number[] = [];
		const stop = effect(() => {
			seen.push(s.get());
		});

		expect(seen).toEqual([0]);

		s.set(1);
		await tick();
		expect(seen).toEqual([0, 1]);

		stop();
	});

	it('should settle a burst of writes into one run', async () => {
		const s = new State(0);
		const seen: number[] = [];
		const stop = effect(() => {
			seen.push(s.get());
		});

		s.set(1);
		s.set(2);
		s.set(3);
		expect(seen).toEqual([0]);

		await tick();
		expect(seen).toEqual([0, 3]);

		stop();
	});

	it('should run once for a value that changed and came back', async () => {
		const s = new State(0);
		const seen: number[] = [];
		const stop = effect(() => {
			seen.push(s.get());
		});

		s.set(1);
		s.set(0);
		await tick();

		// coalescing is about how many times an effect runs, not about whether it
		// runs at all. Both writes were real changes when they happened, and
		// nothing records the value a signal held before a burst -- so the effect
		// runs once, with what the signal settled on
		expect(seen).toEqual([0, 0]);

		stop();
	});

	it('should run a cleanup before each re-run and once on dispose', async () => {
		const s = new State(0);
		const events: string[] = [];

		const stop = effect(() => {
			const value = s.get();
			events.push(`run:${value}`);
			return () => events.push(`cleanup:${value}`);
		});

		expect(events).toEqual(['run:0']);

		s.set(1);
		await tick();
		expect(events).toEqual(['run:0', 'cleanup:0', 'run:1']);

		stop();
		expect(events).toEqual(['run:0', 'cleanup:0', 'run:1', 'cleanup:1']);
	});

	it('should stop running once disposed', async () => {
		const s = new State(0);
		let runs = 0;
		const stop = effect(() => {
			s.get();
			runs++;
		});

		stop();
		s.set(1);
		await tick();
		expect(runs).toBe(1);
	});

	it('should be safe to dispose twice', () => {
		let cleanups = 0;
		const stop = effect(() => () => cleanups++);
		stop();
		stop();
		expect(cleanups).toBe(1);
	});

	it('should release its dependencies on dispose', async () => {
		const events: string[] = [];
		const { unwatched, watched } = await import('../../src/signals/index.js');
		const s = new State(0, {
			[watched]: () => events.push('watched'),
			[unwatched]: () => events.push('unwatched'),
		});

		const stop = effect(() => {
			s.get();
		});
		expect(events).toEqual(['watched']);

		stop();
		expect(events).toEqual(['watched', 'unwatched']);
	});

	it('should track dynamically across re-runs', async () => {
		const useLeft = new State(true);
		const left = new State('L');
		const right = new State('R');
		const seen: string[] = [];

		const stop = effect(() => {
			seen.push(useLeft.get() ? left.get() : right.get());
		});

		expect(seen).toEqual(['L']);

		right.set('R2');
		await tick();
		expect(seen).toEqual(['L']);

		useLeft.set(false);
		await tick();
		expect(seen).toEqual(['L', 'R2']);

		left.set('L2');
		await tick();
		expect(seen).toEqual(['L', 'R2']);

		stop();
	});

	it('should see a computed through to its state', async () => {
		const s = new State(1);
		const doubled = new Computed(() => s.get() * 2);
		const seen: number[] = [];

		const stop = effect(() => {
			seen.push(doubled.get());
		});

		expect(seen).toEqual([2]);
		s.set(5);
		await tick();
		expect(seen).toEqual([2, 10]);

		stop();
	});

	it('should let a throw out of the first run', () => {
		expect(() =>
			effect(() => {
				throw new Error('bang');
			})
		).toThrow('bang');
	});

	it('should run every pending effect even when one throws', () => {
		const scheduler = manualScheduler();
		try {
			const s = new State(0);
			const ran: string[] = [];

			const stopBad = effect(() => {
				if (s.get() > 0) {
					throw new Error('bang');
				}
				ran.push('bad');
			});
			const stopGood = effect(() => {
				s.get();
				ran.push('good');
			});

			expect(ran).toEqual(['bad', 'good']);

			s.set(1);
			expect(() => scheduler.run()).toThrow('bang');

			// the healthy effect ran even though the other one threw
			expect(ran).toEqual(['bad', 'good', 'good']);

			stopBad();
			stopGood();
		} finally {
			scheduler.restore();
		}
	});

	it('should keep working after an effect throws', () => {
		const scheduler = manualScheduler();
		try {
			const s = new State(0);
			const seen: number[] = [];

			const stopBad = effect(() => {
				if (s.get() === 1) {
					throw new Error('bang');
				}
			});
			const stopGood = effect(() => {
				seen.push(s.get());
			});

			s.set(1);
			expect(() => scheduler.run()).toThrow('bang');
			expect(seen).toEqual([0, 1]);

			// a disarmed watcher would end all future reactivity here
			s.set(2);
			scheduler.run();
			expect(seen).toEqual([0, 1, 2]);

			stopBad();
			stopGood();
		} finally {
			scheduler.restore();
		}
	});
});

describe('setScheduler', () => {
	afterEach(() => {
		setScheduler(undefined);
	});

	it('should ask the scheduler once for a burst of writes', () => {
		const scheduler = manualScheduler();
		try {
			const s = new State(0);
			const stop = effect(() => {
				s.get();
			});

			s.set(1);
			s.set(2);
			s.set(3);
			expect(scheduler.queued).toBe(1);

			scheduler.run();
			stop();
		} finally {
			scheduler.restore();
		}
	});

	it('should ask again after the queue has been drained', () => {
		const scheduler = manualScheduler();
		try {
			const s = new State(0);
			const stop = effect(() => {
				s.get();
			});

			s.set(1);
			expect(scheduler.queued).toBe(1);
			scheduler.run();

			s.set(2);
			expect(scheduler.queued).toBe(1);
			scheduler.run();

			stop();
		} finally {
			scheduler.restore();
		}
	});

	it('should not schedule anything when nothing is watching', () => {
		const scheduler = manualScheduler();
		try {
			const s = new State(0);
			s.set(1);
			s.set(2);
			expect(scheduler.queued).toBe(0);
		} finally {
			scheduler.restore();
		}
	});

	it('should hand back the scheduler it replaced', () => {
		const mine = (fn: () => void) => fn();
		const previous = setScheduler(mine);
		expect(setScheduler(previous)).toBe(mine);
	});

	it('should let flush be driven by hand', () => {
		const scheduler = manualScheduler();
		try {
			const s = new State(0);
			const seen: number[] = [];
			const stop = effect(() => {
				seen.push(s.get());
			});

			s.set(1);
			expect(seen).toEqual([0]);
			flush();
			expect(seen).toEqual([0, 1]);

			stop();
		} finally {
			scheduler.restore();
		}
	});
});
