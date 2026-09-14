import { ESC } from '../ansi/codes.js';

/**
 * A cell's style, and the SGR needed to move from one to another.
 *
 * Kept apart from `src/ansi/`, which styles *strings* by wrapping them in an
 * open and a close. A cell grid has no strings to wrap: the diff walks from the
 * style already in effect to the style the next cell wants and emits only the
 * difference, so what it needs is a value to compare rather than a pair of
 * bookends.
 */

/** A colour: the terminal's own, a palette index, or 24-bit. */
export type Color = number;

/** The terminal's own foreground or background, whatever the user set it to. */
export const DEFAULT_COLOR: Color = -1;

/** Where the 24-bit range starts, past the 256 palette. */
const RGB_BASE = 0x100;

/**
 * A palette colour. `0`-`7` are the basic set, `8`-`15` the bright set, and
 * `16`-`255` the xterm cube and grey ramp.
 *
 * @param index - The palette index.
 * @returns The colour.
 */
export function palette(index: number): Color {
	return Math.max(0, Math.min(255, Math.trunc(index)));
}

/**
 * A 24-bit colour, packed above the palette range so that any two colours can
 * be compared with `===` regardless of which kind they are.
 *
 * @param r - Red, 0-255.
 * @param g - Green, 0-255.
 * @param b - Blue, 0-255.
 * @returns The colour.
 */
export function rgb(r: number, g: number, b: number): Color {
	const byte = (n: number) => Math.max(0, Math.min(255, Math.trunc(n)));
	return RGB_BASE + ((byte(r) << 16) | (byte(g) << 8) | byte(b));
}

/** Whether a colour is 24-bit rather than a palette index. */
function isRgb(color: Color): boolean {
	return color >= RGB_BASE;
}

/**
 * The text attributes, as bits, so a whole style compares as three numbers.
 *
 * Written as literals rather than as shifts because `isolatedDeclarations`
 * cannot infer the type of `1 << 3` -- the same reason the SGR table in
 * `src/ansi/codes.ts` spells its codes out.
 */
export const ATTR = {
	none: 0,
	bold: 1,
	dim: 2,
	italic: 4,
	underline: 8,
	inverse: 16,
	hidden: 32,
	strikethrough: 64,
	overline: 128,
} as const;

/** The SGR code that turns each attribute on, and the one that turns it off. */
const ATTR_CODES: [bit: number, on: number, off: number][] = [
	[ATTR.bold, 1, 22],
	[ATTR.dim, 2, 22],
	[ATTR.italic, 3, 23],
	[ATTR.underline, 4, 24],
	[ATTR.inverse, 7, 27],
	[ATTR.hidden, 8, 28],
	[ATTR.strikethrough, 9, 29],
	[ATTR.overline, 53, 55],
];

/**
 * `bold` and `dim` share a closing code, so turning one off turns the other off
 * too and whichever is still wanted has to be reopened.
 */
const SHARED_OFF = new Map<number, number>([[22, ATTR.bold | ATTR.dim]]);

export interface Style {
	attrs: number;
	bg: Color;
	fg: Color;
}

/** What a cell looks like when nothing has styled it. */
export const DEFAULT_STYLE: Style = {
	attrs: ATTR.none,
	bg: DEFAULT_COLOR,
	fg: DEFAULT_COLOR,
};

/**
 * Interns styles so a cell holds a number rather than an object.
 *
 * A grid repeats a handful of styles across thousands of cells, and the diff's
 * inner loop asks "same style?" once per cell. Comparing integers rather than
 * three fields of an object is most of what makes that loop cheap, and it means
 * the grid can keep its styles in a typed array.
 */
export class StyleTable {
	#styles: Style[] = [DEFAULT_STYLE];
	#index = new Map<number, number>([[0, 0]]);

	/** The index of the default style, which is always zero. */
	static readonly DEFAULT = 0;

	/**
	 * A key that is unique per style and cheap to compute.
	 *
	 * The two colours and the attribute bits do not fit in 32 bits together, so
	 * this multiplies rather than shifts -- the result stays an exact integer
	 * well inside `Number.MAX_SAFE_INTEGER` for every representable style.
	 *
	 * @param style - The style to key.
	 * @returns The key.
	 */
	static key(style: Style): number {
		const fg = style.fg + 1;
		const bg = style.bg + 1;
		return (fg * 0x100_0001 + bg) * 0x100 + (style.attrs & 0xff);
	}

	/**
	 * The index for a style, adding it if this is the first time it is seen.
	 *
	 * @param style - The style to intern.
	 * @returns Its index.
	 */
	intern(style: Style): number {
		const key = StyleTable.key(style);
		const existing = this.#index.get(key);
		if (existing !== undefined) {
			return existing;
		}
		const index = this.#styles.length;
		// copied, so a caller reusing one object to paint many cells cannot
		// retroactively change what a cell was painted with
		this.#styles.push({ attrs: style.attrs & 0xff, bg: style.bg, fg: style.fg });
		this.#index.set(key, index);
		return index;
	}

	/**
	 * The style at an index.
	 *
	 * @param index - The index.
	 * @returns The style, or the default for an index nothing interned.
	 */
	get(index: number): Style {
		return this.#styles[index] ?? DEFAULT_STYLE;
	}

	/** How many distinct styles have been interned, the default included. */
	get size(): number {
		return this.#styles.length;
	}
}

/**
 * The SGR parameters that set a foreground or background colour.
 *
 * The colon form is used for 24-bit and 256 colour, which is what ITU T.416
 * actually specifies; the semicolon form is the widespread misreading of it.
 * Both are understood everywhere that understands either, and the colon form
 * cannot be mistaken for a run of separate parameters -- which is the bug
 * `reopen()` in the styler and `createSgrState()` in the wrapper both had to
 * learn about the hard way.
 *
 * @param color - The colour to set.
 * @param background - Whether this is the background.
 * @returns The parameters, without the CSI or the trailing `m`.
 */
function colorParams(color: Color, background: boolean): string {
	const base = background ? 40 : 30;

	if (color === DEFAULT_COLOR) {
		return String(base + 9);
	}

	if (isRgb(color)) {
		const value = color - RGB_BASE;
		const r = (value >> 16) & 0xff;
		const g = (value >> 8) & 0xff;
		const b = value & 0xff;
		return `${base + 8}:2::${r}:${g}:${b}`;
	}

	// the basic eight and the bright eight have their own codes, which are
	// shorter and are understood by terminals that do not do 256 colour at all
	if (color < 8) {
		return String(base + color);
	}
	if (color < 16) {
		return String((background ? 100 : 90) + color - 8);
	}

	return `${base + 8}:5:${color}`;
}

/**
 * The SGR sequence that turns `from` into `to`, or an empty string when they
 * are already the same.
 *
 * Only the difference is emitted. A full reset before every run would be
 * simpler and would roughly double the bytes on the wire for a screen of
 * styled text, which is the cost this whole module exists to avoid.
 *
 * @param from - The style currently in effect.
 * @param to - The style wanted.
 * @returns The sequence.
 */
export function transition(from: Style, to: Style): string {
	const params: string[] = [];

	const turnOff = from.attrs & ~to.attrs;
	let attrs = from.attrs;

	if (turnOff) {
		const emitted = new Set<number>();
		for (const [bit, , off] of ATTR_CODES) {
			if (turnOff & bit && !emitted.has(off)) {
				emitted.add(off);
				params.push(String(off));
				// a closing code shared with another attribute takes that one down
				// too, so anything still wanted has to be reopened below
				attrs &= ~(SHARED_OFF.get(off) ?? bit);
			}
		}
	}

	const turnOn = to.attrs & ~attrs;
	if (turnOn) {
		for (const [bit, on] of ATTR_CODES) {
			if (turnOn & bit) {
				params.push(String(on));
			}
		}
	}

	if (from.fg !== to.fg) {
		params.push(colorParams(to.fg, false));
	}

	if (from.bg !== to.bg) {
		params.push(colorParams(to.bg, true));
	}

	return params.length ? `${ESC}[${params.join(';')}m` : '';
}

/** Puts every attribute and colour back to the terminal's own. */
export const RESET: string = `${ESC}[0m`;
