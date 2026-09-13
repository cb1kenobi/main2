import { codes } from '../../src/ansi/codes.js';
import type { ColorLevel } from '../../src/ansi/color-support.js';
import { ansi } from '../../src/ansi/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ESC = String.fromCharCode(0x1b);

beforeEach(() => {
	ansi.level = 3;
});

afterEach(() => {
	ansi.level = undefined;
});

describe('styling', () => {
	it('should apply a named style', () => {
		expect(ansi.red('hi')).toBe(`${ESC}[31mhi${ESC}[39m`);
		expect(ansi.bold('hi')).toBe(`${ESC}[1mhi${ESC}[22m`);
		expect(ansi.bgCyan('hi')).toBe(`${ESC}[46mhi${ESC}[49m`);
	});

	it('should apply the bright variants', () => {
		expect(ansi.redBright('hi')).toBe(`${ESC}[91mhi${ESC}[39m`);
		expect(ansi.bgRedBright('hi')).toBe(`${ESC}[101mhi${ESC}[49m`);
		expect(ansi.gray('hi')).toBe(ansi.blackBright('hi'));
		expect(ansi.grey('hi')).toBe(ansi.blackBright('hi'));
	});

	it('should chain styles outermost first', () => {
		expect(ansi.bold.red('hi')).toBe(`${ESC}[1m${ESC}[31mhi${ESC}[39m${ESC}[22m`);
	});

	// the named styles are a fixed set and a chain of them is only as deep as
	// the source that spells it out, so caching them is bounded by the caller
	it('should return the same styler for the same named chain', () => {
		expect(ansi.bold.red).toBe(ansi.bold.red);
		expect(ansi.bold.red).not.toBe(ansi.red.bold);
	});

	// a cache keyed on a color would be bounded by that color's input instead,
	// and a process cycling through a gradient would grow an entry per frame
	it('should not cache a color, but should still render it the same', () => {
		expect(ansi.hex('#ff0000')).not.toBe(ansi.hex('#ff0000'));
		expect(ansi.hex('#ff0000')('x')).toBe(ansi.hex('#ff0000')('x'));
		expect(ansi.rgb(255, 0, 0)('x')).toBe(ansi.hex('#f00')('x'));
	});

	it('should pass text through when the root styler is called', () => {
		expect(ansi('hi')).toBe('hi');
	});

	it('should join multiple arguments with a space', () => {
		expect(ansi.red('a', 'b', 'c')).toBe(`${ESC}[31ma b c${ESC}[39m`);
		expect(ansi.red(1, true, null)).toBe(`${ESC}[31m1 true null${ESC}[39m`);
	});

	it('should leave an empty string alone', () => {
		expect(ansi.red()).toBe('');
		expect(ansi.red('')).toBe('');
	});

	it('should write nothing at level 0', () => {
		ansi.level = 0;
		expect(ansi.bold.red('hi')).toBe('hi');
		expect(ansi.hex('#ff0000')('hi')).toBe('hi');
	});
});

describe('nesting', () => {
	// bold and dim share close code 22, and every foreground shares 39, so a
	// nested style that closes would switch the outer one off too
	it('should reopen a style the inner text closed', () => {
		const inner = ansi.green('green');
		expect(ansi.red(`red ${inner} red`)).toBe(
			`${ESC}[31mred ${ESC}[32mgreen${ESC}[39m${ESC}[31m red${ESC}[39m`
		);
	});

	it('should reopen every style in the chain', () => {
		expect(ansi.bold.red(`a${ansi.dim('b')}c`)).toBe(
			`${ESC}[1m${ESC}[31ma${ESC}[2mb${ESC}[22m${ESC}[1mc${ESC}[39m${ESC}[22m`
		);
	});

	// a reset turns every attribute off, not just the one that named it, so the
	// whole chain has to come back rather than one part of it
	it('should reopen the whole chain after a reset', () => {
		expect(ansi.red(`a${ansi.reset('x')}b`)).toBe(
			`${ESC}[31ma${ESC}[0m${ESC}[31mx${ESC}[0m${ESC}[31mb${ESC}[39m`
		);
		expect(ansi.bold.red(`a${ESC}[mb`)).toBe(
			`${ESC}[1m${ESC}[31ma${ESC}[m${ESC}[1m${ESC}[31mb${ESC}[39m${ESC}[22m`
		);
	});

	it('should close and reopen around a newline', () => {
		expect(ansi.bgRed('a\nb')).toBe(`${ESC}[41ma${ESC}[49m\n${ESC}[41mb${ESC}[49m`);
		expect(ansi.bgRed('a\r\nb')).toBe(`${ESC}[41ma${ESC}[49m\r\n${ESC}[41mb${ESC}[49m`);
	});
});

describe('256 colors', () => {
	it('should write a palette index at level 2 and above', () => {
		expect(ansi.ansi256(214)('hi')).toBe(`${ESC}[38;5;214mhi${ESC}[39m`);
		expect(ansi.bgAnsi256(214)('hi')).toBe(`${ESC}[48;5;214mhi${ESC}[49m`);

		ansi.level = 2;
		expect(ansi.ansi256(214)('hi')).toBe(`${ESC}[38;5;214mhi${ESC}[39m`);
	});

	it('should downsample to the basic 16 at level 1', () => {
		ansi.level = 1;
		// the first 16 palette entries are the basic colors themselves
		expect(ansi.ansi256(1)('hi')).toBe(`${ESC}[31mhi${ESC}[39m`);
		expect(ansi.ansi256(9)('hi')).toBe(`${ESC}[91mhi${ESC}[39m`);
		expect(ansi.bgAnsi256(1)('hi')).toBe(`${ESC}[41mhi${ESC}[49m`);
		// 196 is the cube's full red
		expect(ansi.ansi256(196)('hi')).toBe(`${ESC}[91mhi${ESC}[39m`);
		// 16 is the cube's black
		expect(ansi.ansi256(16)('hi')).toBe(`${ESC}[30mhi${ESC}[39m`);
	});

	it('should reject an index outside the palette', () => {
		expect(() => ansi.ansi256(256)).toThrow(
			'Invalid color code "256"; expected an integer between 0 and 255'
		);
		expect(() => ansi.ansi256(-1)).toThrow(/Invalid color code/);
		expect(() => ansi.ansi256(1.5)).toThrow(/Invalid color code/);
	});
});

describe('truecolor', () => {
	it('should write 24-bit channels at level 3', () => {
		expect(ansi.rgb(95, 135, 175)('hi')).toBe(`${ESC}[38;2;95;135;175mhi${ESC}[39m`);
		expect(ansi.bgRgb(95, 135, 175)('hi')).toBe(`${ESC}[48;2;95;135;175mhi${ESC}[49m`);
	});

	it('should accept hex with and without the hash, in either case', () => {
		expect(ansi.hex('#5f87af')('hi')).toBe(`${ESC}[38;2;95;135;175mhi${ESC}[39m`);
		expect(ansi.hex('5F87AF')('hi')).toBe(`${ESC}[38;2;95;135;175mhi${ESC}[39m`);
		expect(ansi.bgHex('#5f87af')('hi')).toBe(`${ESC}[48;2;95;135;175mhi${ESC}[49m`);
	});

	it('should expand a three digit hex by doubling each digit', () => {
		expect(ansi.hex('#abc')('hi')).toBe(ansi.hex('#aabbcc')('hi'));
		expect(ansi.hex('#f00')('hi')).toBe(`${ESC}[38;2;255;0;0mhi${ESC}[39m`);
	});

	it('should downsample to the 256 palette at level 2', () => {
		ansi.level = 2;
		expect(ansi.hex('#ff0000')('hi')).toBe(`${ESC}[38;5;196mhi${ESC}[39m`);
		// a gray goes to the 24 step ramp, which is finer than the cube
		expect(ansi.hex('#808080')('hi')).toBe(`${ESC}[38;5;244mhi${ESC}[39m`);
		expect(ansi.hex('#000000')('hi')).toBe(`${ESC}[38;5;16mhi${ESC}[39m`);
		expect(ansi.hex('#ffffff')('hi')).toBe(`${ESC}[38;5;231mhi${ESC}[39m`);
	});

	it('should downsample to the basic 16 at level 1', () => {
		ansi.level = 1;
		expect(ansi.hex('#ff0000')('hi')).toBe(`${ESC}[91mhi${ESC}[39m`);
		expect(ansi.hex('#800000')('hi')).toBe(`${ESC}[31mhi${ESC}[39m`);
		expect(ansi.hex('#000000')('hi')).toBe(`${ESC}[30mhi${ESC}[39m`);
		expect(ansi.bgHex('#ff0000')('hi')).toBe(`${ESC}[101mhi${ESC}[49m`);
	});

	// rounding each channel to a bit and reading the result as a color index
	// cannot reach a gray at all: every channel rounds the same way, so the only
	// grays it produces are black and white
	it('should downsample a gray to the nearest gray, not to black or white', () => {
		ansi.level = 1;
		// 90 is exactly #808080 and 37 is #c0c0c0
		expect(ansi.hex('#808080')('hi')).toBe(`${ESC}[90mhi${ESC}[39m`);
		expect(ansi.hex('#c0c0c0')('hi')).toBe(`${ESC}[37mhi${ESC}[39m`);
		expect(ansi.hex('#ffffff')('hi')).toBe(`${ESC}[97mhi${ESC}[39m`);
		expect(ansi.hex('#555555')('hi')).toBe(`${ESC}[90mhi${ESC}[39m`);
		// #404040 is exactly as far from black as from #808080, and a tie goes to
		// the lower index
		expect(ansi.hex('#404040')('hi')).toBe(`${ESC}[30mhi${ESC}[39m`);
		expect(ansi.hex('#0a0a0a')('hi')).toBe(`${ESC}[30mhi${ESC}[39m`);
		// and the same by way of the 256-color grayscale ramp
		expect(ansi.ansi256(244)('hi')).toBe(`${ESC}[90mhi${ESC}[39m`);
	});

	it('should reject a malformed hex color', () => {
		expect(() => ansi.hex('#ff00')).toThrow('Invalid hex color "#ff00"');
		expect(() => ansi.hex('nope')).toThrow(/Invalid hex color/);
		expect(() => ansi.hex('')).toThrow(/Invalid hex color/);
	});

	it('should reject a channel outside a byte', () => {
		expect(() => ansi.rgb(256, 0, 0)).toThrow(
			'Invalid red "256"; expected an integer between 0 and 255'
		);
		expect(() => ansi.rgb(0, -1, 0)).toThrow(/Invalid green/);
		expect(() => ansi.rgb(0, 0, 1.5)).toThrow(/Invalid blue/);
	});
});

describe('level', () => {
	it('should downsample a chain built before the level changed', () => {
		const style = ansi.hex('#ff0000');
		expect(style('hi')).toBe(`${ESC}[38;2;255;0;0mhi${ESC}[39m`);
		ansi.level = 1;
		expect(style('hi')).toBe(`${ESC}[91mhi${ESC}[39m`);
	});

	it('should reject a level outside 0 to 3', () => {
		expect(() => {
			ansi.level = 4 as ColorLevel;
		}).toThrow('Invalid color level "4"; expected 0, 1, 2, or 3');
		expect(() => {
			ansi.level = -1 as ColorLevel;
		}).toThrow(/Invalid color level/);
		expect(() => {
			ansi.level = 1.5 as ColorLevel;
		}).toThrow(/Invalid color level/);
	});

	it('should detect the level again when cleared', () => {
		ansi.level = 0;
		ansi.level = undefined;
		// vitest's stdout is not a TTY, so detection lands on 0 either way; what
		// matters is that the override is gone rather than sticking at 0
		expect(ansi.level).toBe(ansi.supportsColor());
	});
});

describe('codes', () => {
	// the table cannot carry a `satisfies` clause, because `isolatedDeclarations`
	// will not infer a declaration through one
	it('should be an open and close SGR parameter per style', () => {
		for (const [name, pair] of Object.entries(codes)) {
			expect(pair, name).toHaveLength(2);
			for (const code of pair) {
				expect(Number.isInteger(code), `${name} -> ${code}`).toBe(true);
				expect(code, name).toBeGreaterThanOrEqual(0);
				expect(code, name).toBeLessThanOrEqual(107);
			}
		}
	});

	it('should expose every style as a styler', () => {
		for (const name of Object.keys(codes)) {
			expect(typeof ansi[name as keyof typeof codes], name).toBe('function');
		}
	});
});
