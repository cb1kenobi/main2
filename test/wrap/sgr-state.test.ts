import { createSgrState } from '../../src/wrap/sgr-state.js';
import { describe, expect, it } from 'vitest';

const ESC = String.fromCharCode(0x1b);
const CSI = String.fromCharCode(0x9b);

/** Applies a run of sequences and reports what is left in effect. */
function after(...sequences: string[]) {
	const state = createSgrState();
	for (const sequence of sequences) {
		state.apply(sequence);
	}
	return state;
}

describe('what stays in effect', () => {
	it('should start with nothing', () => {
		const state = createSgrState();
		expect(state.active).toBe(false);
		expect(state.open()).toBe('');
		expect(state.close()).toBe('');
	});

	it('should remember an attribute', () => {
		const state = after(`${ESC}[1m`);
		expect(state.active).toBe(true);
		expect(state.open()).toBe(`${ESC}[1m`);
		expect(state.close()).toBe(`${ESC}[22m`);
	});

	it('should remember several, as one sequence each way', () => {
		const state = after(`${ESC}[1m`, `${ESC}[4m`, `${ESC}[31m`);
		expect(state.open()).toBe(`${ESC}[1;4;31m`);
		expect(state.close()).toBe(`${ESC}[22;24;39m`);
	});

	it('should read several parameters from one sequence', () => {
		expect(after(`${ESC}[1;4;31m`).open()).toBe(`${ESC}[1;4;31m`);
	});

	// two foregrounds in a row leave the second in effect, not both, so the state
	// is one entry per slot rather than a list of everything seen
	it('should let an attribute replace the one holding its slot', () => {
		expect(after(`${ESC}[31m`, `${ESC}[32m`).open()).toBe(`${ESC}[32m`);
		expect(after(`${ESC}[1m`, `${ESC}[2m`).open()).toBe(`${ESC}[2m`);
		expect(after(`${ESC}[31m`, `${ESC}[41m`).open()).toBe(`${ESC}[31;41m`);
	});

	it('should forget what a closing parameter closes', () => {
		expect(after(`${ESC}[1m`, `${ESC}[31m`, `${ESC}[39m`).open()).toBe(`${ESC}[1m`);
		expect(after(`${ESC}[1m`, `${ESC}[22m`).active).toBe(false);
		// bold and dim share a slot and a close
		expect(after(`${ESC}[2m`, `${ESC}[22m`).active).toBe(false);
		expect(after(`${ESC}[4m`, `${ESC}[24m`).active).toBe(false);
		expect(after(`${ESC}[41m`, `${ESC}[49m`).active).toBe(false);
	});

	it('should close a slot named in passing', () => {
		expect(after(`${ESC}[1m`, `${ESC}[31m`, `${ESC}[39;4m`).open()).toBe(`${ESC}[1;4m`);
	});

	it('should forget everything on a reset, however it is spelled', () => {
		for (const reset of [`${ESC}[0m`, `${ESC}[m`, `${ESC}[00m`, `${ESC}[0;0m`, `${CSI}0m`]) {
			expect(after(`${ESC}[1m`, `${ESC}[31m`, reset).active, reset).toBe(false);
		}
		// a reset can carry what comes after it
		expect(after(`${ESC}[1m`, `${ESC}[0;32m`).open()).toBe(`${ESC}[32m`);
	});

	it('should keep the parameters of a 256-color or a truecolor', () => {
		expect(after(`${ESC}[38;5;214m`).open()).toBe(`${ESC}[38;5;214m`);
		expect(after(`${ESC}[38;2;95;135;175m`).open()).toBe(`${ESC}[38;2;95;135;175m`);
		expect(after(`${ESC}[48;2;0;0;0m`).close()).toBe(`${ESC}[49m`);
		// and read what follows them as parameters of their own
		expect(after(`${ESC}[38;5;214;1m`).open()).toBe(`${ESC}[38;5;214;1m`);
		expect(after(`${ESC}[1;38;2;1;2;3;4m`).open()).toBe(`${ESC}[1;38;2;1;2;3;4m`);
	});

	it('should let an extended color replace a simple one and the other way round', () => {
		expect(after(`${ESC}[31m`, `${ESC}[38;5;214m`).open()).toBe(`${ESC}[38;5;214m`);
		expect(after(`${ESC}[38;5;214m`, `${ESC}[31m`).open()).toBe(`${ESC}[31m`);
	});

	it('should read the single byte C1 form', () => {
		expect(after(`${CSI}1m`).open()).toBe(`${ESC}[1m`);
	});

	// the sub-parameter of a curly underline belongs to the 4, not to the list
	it('should not read a sub-parameter as a parameter', () => {
		expect(after(`${ESC}[4:3m`).open()).toBe(`${ESC}[4m`);
	});

	it('should ignore what it does not model rather than guess at a slot', () => {
		// 10 is a font selection, 51 is framed, 73 is superscript
		expect(after(`${ESC}[10m`).active).toBe(false);
		expect(after(`${ESC}[1m`, `${ESC}[51m`).open()).toBe(`${ESC}[1m`);
	});

	it('should ignore a sequence that is not an SGR', () => {
		for (const sequence of [
			`${ESC}[2J`,
			`${ESC}[1;1H`,
			`${ESC}]8;;https://example.com${String.fromCharCode(0x07)}`,
			`${ESC}(B`,
			'not a sequence',
			'',
		]) {
			expect(after(`${ESC}[1m`, sequence).open(), JSON.stringify(sequence)).toBe(`${ESC}[1m`);
		}
	});

	// closing the slots that are open, rather than writing a blanket reset, so
	// that styling the surrounding output had set and this text never touched
	// survives
	it('should close only the slots it opened', () => {
		expect(after(`${ESC}[31m`).close()).toBe(`${ESC}[39m`);
		expect(after(`${ESC}[31m`).close()).not.toContain('0m');
	});

	it('should forget everything when reset', () => {
		const state = after(`${ESC}[1m`, `${ESC}[31m`);
		state.reset();
		expect(state.active).toBe(false);
		expect(state.open()).toBe('');
	});
});
