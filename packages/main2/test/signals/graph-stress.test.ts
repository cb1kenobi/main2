import { Computed, State } from '../../src/signals/index.js';
import { describe, expect, it } from 'vitest';

/**
 * A graph written by hand is checked against the cases somebody thought of. A
 * graph checked against a naive evaluator is checked against every case the
 * generator produces, which is the only way to have any confidence in caching
 * and invalidation written from scratch.
 *
 * The naive side recomputes everything from the states on every read. The real
 * side caches aggressively. Any disagreement is a bug in the caching, which is
 * the entire risk this module carries.
 */

/** A seeded generator, so a failure names a seed that reproduces it. */
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		// xorshift32
		s ^= s << 13;
		s >>>= 0;
		s ^= s >>> 17;
		s ^= s << 5;
		s >>>= 0;
		return s / 0x1_0000_0000;
	};
}

interface Plan {
	/** For each computed, the node indices it reads. */
	deps: number[][];
	stateCount: number;
}

/** The value of node `i` computed from scratch, with no caching anywhere. */
function evaluate(plan: Plan, states: number[], index: number): number {
	if (index < plan.stateCount) {
		return states[index];
	}
	const deps = plan.deps[index - plan.stateCount];
	let total = index;
	for (const dep of deps) {
		total += evaluate(plan, states, dep);
	}
	// modulo on purpose: it makes plenty of recomputes land on the same value,
	// which is what exercises the "recomputed but unchanged" path
	return total % 97;
}

describe('the reactive graph, against a naive evaluator', () => {
	for (const seed of [1, 2, 3, 12345, 987654321]) {
		it(`should agree with a from-scratch evaluation (seed ${seed})`, () => {
			const random = rng(seed);
			const stateCount = 4;
			const computedCount = 12;
			const plan: Plan = { deps: [], stateCount };

			const states = Array.from({ length: stateCount }, (_, i) => i);
			const stateSignals = states.map((v) => new State(v));
			const nodes: (State<number> | Computed<number>)[] = [...stateSignals];

			// each computed reads only earlier nodes, which keeps it a DAG
			for (let c = 0; c < computedCount; c++) {
				const available = nodes.length;
				const count = 1 + Math.floor(random() * Math.min(3, available));
				const deps: number[] = [];
				for (let d = 0; d < count; d++) {
					const pick = Math.floor(random() * available);
					if (!deps.includes(pick)) {
						deps.push(pick);
					}
				}
				plan.deps.push(deps);

				const index = stateCount + c;
				nodes.push(
					new Computed(() => {
						let total = index;
						for (const dep of deps) {
							total += nodes[dep].get();
						}
						return total % 97;
					})
				);
			}

			for (let step = 0; step < 300; step++) {
				if (random() < 0.4) {
					const which = Math.floor(random() * stateCount);
					const value = Math.floor(random() * 50);
					states[which] = value;
					stateSignals[which].set(value);
				} else {
					const which = Math.floor(random() * nodes.length);
					expect(nodes[which].get(), `node ${which} at step ${step}`).toBe(
						evaluate(plan, states, which)
					);
				}
			}

			// and everything agrees once the dust settles
			for (let i = 0; i < nodes.length; i++) {
				expect(nodes[i].get(), `node ${i} at rest`).toBe(evaluate(plan, states, i));
			}
		});
	}

	it('should never run a computed twice for one settled read', () => {
		const a = new State(1);
		const b = new State(2);
		const runs = new Map<string, number>();

		const count = (name: string) => runs.set(name, (runs.get(name) ?? 0) + 1);

		// a wide diamond: many paths from the states to the top
		const l1 = new Computed(() => {
			count('l1');
			return a.get() + b.get();
		});
		const l2 = new Computed(() => {
			count('l2');
			return a.get() - b.get();
		});
		const l3 = new Computed(() => {
			count('l3');
			return l1.get() * 2;
		});
		const l4 = new Computed(() => {
			count('l4');
			return l1.get() + l2.get();
		});
		const top = new Computed(() => {
			count('top');
			return l3.get() + l4.get();
		});

		top.get();
		expect([...runs.values()].every((n) => n === 1)).toBe(true);

		runs.clear();
		a.set(10);
		top.get();
		// one write, one run each -- a node reachable by two paths must not run twice
		expect(Object.fromEntries(runs)).toEqual({ l1: 1, l2: 1, l3: 1, l4: 1, top: 1 });
	});

	it('should not recompute an unread branch when a shared source changes', () => {
		const shared = new State(0);
		let coldRuns = 0;

		const hot = new Computed(() => shared.get() + 1);
		const cold = new Computed(() => {
			coldRuns++;
			return shared.get() + 2;
		});

		expect(hot.get()).toBe(1);
		expect(coldRuns).toBe(0);

		shared.set(5);
		expect(hot.get()).toBe(6);

		// laziness is the whole reason a CLI can afford this: a computed nobody
		// reads never runs, however often its inputs change
		expect(coldRuns).toBe(0);
		expect(cold.get()).toBe(7);
		expect(coldRuns).toBe(1);
	});
});
