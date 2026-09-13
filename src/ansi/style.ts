import { codes, ESC, sgr, type StyleName } from './codes.js';
import { type ColorLevel, getColorLevel } from './color-support.js';

/**
 * One style in a chain: the sequence that turns it on and the one that turns
 * it off.
 *
 * `open` is a function for the colors whose rendering depends on the level --
 * a truecolor request has to come out as a 256-color or a 16-color sequence on
 * a terminal that cannot do better -- and the level is read when the text is
 * rendered, not when the chain was built, so setting the level after building
 * a styler still changes what that styler writes.
 */
interface Part {
	open: string | ((level: ColorLevel) => string);
	close: string;
}

const Parts: unique symbol = Symbol('main2.ansi.parts');
const Cache: unique symbol = Symbol('main2.ansi.cache');

/**
 * A callable style. Every style name is also a property that returns another
 * one with that style added, so `ansi.bold.red` is a styler and
 * `ansi.bold.red('x')` is the styled text.
 */
export interface Styler {
	(...text: unknown[]): string;

	/** The 256-color palette, by index. */
	ansi256(code: number): Styler;
	/** The 256-color palette as a background, by index. */
	bgAnsi256(code: number): Styler;
	/** A background color from a hex string, with or without the `#`. */
	bgHex(hex: string): Styler;
	/** A background color from 8-bit channel values. */
	bgRgb(red: number, green: number, blue: number): Styler;
	/** A foreground color from a hex string, with or without the `#`. */
	hex(hex: string): Styler;
	/** A foreground color from 8-bit channel values. */
	rgb(red: number, green: number, blue: number): Styler;
}

export type Styles = { readonly [K in StyleName]: Styler };

export interface Styler extends Styles {}

interface InternalStyler extends Styler {
	[Parts]: Part[];
	[Cache]: Map<StyleName, Styler>;
}

/**
 * The shared prototype every styler inherits, so the forty-odd style getters
 * are defined once rather than on each link of every chain.
 */
const proto = Object.create(Function.prototype) as InternalStyler;

for (const name of Object.keys(codes) as StyleName[]) {
	const [open, close] = codes[name];
	const part: Part = { open: sgr(open), close: sgr(close) };

	Object.defineProperty(proto, name, {
		configurable: true,
		get(this: InternalStyler) {
			return chain(this, name, part);
		},
	});
}

Object.defineProperties(proto, {
	ansi256: method(function (this: InternalStyler, code: number) {
		const n = assertByte(code, 'color code');
		return extend(this, {
			open: (level) => (level >= 2 ? sgr(`38;5;${n}`) : sgr(rgbToBasic(...ansi256ToRgb(n), false))),
			close: sgr(39),
		});
	}),
	bgAnsi256: method(function (this: InternalStyler, code: number) {
		const n = assertByte(code, 'color code');
		return extend(this, {
			open: (level) => (level >= 2 ? sgr(`48;5;${n}`) : sgr(rgbToBasic(...ansi256ToRgb(n), true))),
			close: sgr(49),
		});
	}),
	bgHex: method(function (this: InternalStyler, hex: string) {
		const [r, g, b] = hexToRgb(hex);
		return this.bgRgb(r, g, b);
	}),
	bgRgb: method(function (this: InternalStyler, red: number, green: number, blue: number) {
		return rgbChain(this, red, green, blue, true);
	}),
	hex: method(function (this: InternalStyler, hex: string) {
		const [r, g, b] = hexToRgb(hex);
		return this.rgb(r, g, b);
	}),
	rgb: method(function (this: InternalStyler, red: number, green: number, blue: number) {
		return rgbChain(this, red, green, blue, false);
	}),
});

/**
 * A non-enumerable, writable property descriptor, matching what a method
 * declared in a class body would get.
 *
 * @param value - The function to describe.
 * @returns The descriptor.
 */
function method(value: (...args: never[]) => unknown): PropertyDescriptor {
	return { configurable: true, value, writable: true };
}

/**
 * Builds the root styler, which adds no styles of its own -- `ansi('x')` is
 * `'x'` -- and is the head of every chain.
 *
 * @returns The styler.
 */
export function createStyler(): Styler {
	return build([]);
}

/**
 * Builds a styler from a list of parts.
 *
 * @param parts - The styles to apply, outermost first.
 * @returns The styler.
 */
function build(parts: Part[]): Styler {
	const styler = ((...text: unknown[]) => render(parts, text)) as InternalStyler;
	Object.setPrototypeOf(styler, proto);
	styler[Parts] = parts;
	styler[Cache] = new Map();
	return styler;
}

/**
 * Extends a styler with one named style, reusing the styler already built for
 * that name. Chains are read repeatedly -- a help screen asks for
 * `ansi.bold.cyan` once per command -- and without the cache every read walks
 * a getter and allocates.
 *
 * Only the named styles are cached. There are fifty of them and a chain of
 * them can only be as deep as the source that spells it out, so the cache is
 * bounded by the calling code. A cache keyed on a color instead would be
 * bounded by that color's input, and a process cycling through a gradient
 * would grow one entry per frame forever; `extend()` builds those fresh.
 *
 * @param parent - The styler being extended.
 * @param name - The style being added.
 * @param part - The style to add.
 * @returns The extended styler.
 */
function chain(parent: InternalStyler, name: StyleName, part: Part): Styler {
	let styler = parent[Cache].get(name);
	if (!styler) {
		styler = extend(parent, part);
		parent[Cache].set(name, styler);
	}
	return styler;
}

/**
 * Extends a styler with one part, without caching it.
 *
 * @param parent - The styler being extended.
 * @param part - The style to add.
 * @returns The extended styler.
 */
function extend(parent: InternalStyler, part: Part): Styler {
	return build([...parent[Parts], part]);
}

/**
 * Adds a 24-bit color, downsampled to whatever the level can render.
 *
 * @param parent - The styler being extended.
 * @param red - The red channel, 0-255.
 * @param green - The green channel, 0-255.
 * @param blue - The blue channel, 0-255.
 * @param background - Whether the color is a background.
 * @returns The extended styler.
 */
function rgbChain(
	parent: InternalStyler,
	red: number,
	green: number,
	blue: number,
	background: boolean
): Styler {
	const r = assertByte(red, 'red');
	const g = assertByte(green, 'green');
	const b = assertByte(blue, 'blue');
	const prefix = background ? 48 : 38;

	return extend(parent, {
		open: (level) => {
			if (level >= 3) {
				return sgr(`${prefix};2;${r};${g};${b}`);
			}
			if (level === 2) {
				return sgr(`${prefix};5;${rgbToAnsi256(r, g, b)}`);
			}
			return sgr(rgbToBasic(r, g, b, background));
		},
		close: sgr(background ? 49 : 39),
	});
}

/**
 * Wraps text in a chain's sequences.
 *
 * Three details beyond the obvious concatenation, all of which only show up in
 * composed output:
 *
 * - Close codes are shared, so text that already closed bold would leave the
 *   outer bold off for the rest of the line. Every close this chain owns is
 *   followed by its own open again.
 * - A reset closes everything, not just one style, so the whole chain is
 *   reopened after one rather than one part of it.
 * - A style left open across a newline bleeds into whatever the terminal draws
 *   at the start of the next line, which for a background color means the
 *   margin. Each line closes and reopens instead.
 *
 * @param parts - The styles to apply.
 * @param args - What to style; joined with spaces, as `console.log` does.
 * @returns The styled text.
 */
function render(parts: Part[], args: unknown[]): string {
	let text = args.length === 1 ? String(args[0]) : args.map(String).join(' ');

	const level = getColorLevel();
	if (level === 0 || parts.length === 0 || text === '') {
		return text;
	}

	let openAll = '';
	let closeAll = '';
	const opened: [close: string, open: string][] = [];

	for (const part of parts) {
		const open = typeof part.open === 'string' ? part.open : part.open(level);
		openAll += open;
		closeAll = part.close + closeAll;
		opened.push([part.close, open]);
	}

	if (text.includes(ESC)) {
		// a reset turns every attribute off, so what follows one has to be the
		// whole chain again; `ESC[m` with no parameters means the same as `ESC[0m`
		for (const reset of resets) {
			if (text.includes(reset)) {
				text = text.replaceAll(reset, reset + openAll);
			}
		}

		for (const [close, open] of opened) {
			// a `reset` part closes with a reset, which the loop above handled
			if (!resets.includes(close) && text.includes(close)) {
				text = text.replaceAll(close, close + open);
			}
		}
	}

	if (text.includes('\n')) {
		text = text.replace(/\r?\n/g, (newline) => `${closeAll}${newline}${openAll}`);
	}

	return `${openAll}${text}${closeAll}`;
}

/** The two spellings of a reset, which closes every attribute at once. */
const resets = [sgr(0), sgr('')];

/**
 * Parses `#rgb`, `#rrggbb`, and the same two without the `#`.
 *
 * @param hex - The hex color.
 * @returns The channel values.
 */
function hexToRgb(hex: string): [number, number, number] {
	const match = /^#?(?:([\da-f]{3})|([\da-f]{6}))$/i.exec(String(hex));

	if (!match) {
		throw new Error(`Invalid hex color "${hex}"`);
	}

	// `#abc` is `#aabbcc`, not `#0a0b0c`
	const value = match[1] ? match[1].replace(/./g, '$&$&') : match[2]!;
	const int = Number.parseInt(value, 16);

	return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/**
 * The nearest index in the 256-color palette.
 *
 * The palette is 16 system colors, a 6x6x6 RGB cube, and a 24-step grayscale
 * ramp. A gray goes to the ramp, which is finer than the cube's four gray
 * steps; everything else goes to the cube.
 *
 * @param red - The red channel, 0-255.
 * @param green - The green channel, 0-255.
 * @param blue - The blue channel, 0-255.
 * @returns The palette index.
 */
function rgbToAnsi256(red: number, green: number, blue: number): number {
	if (red === green && green === blue) {
		if (red < 8) {
			return 16;
		}
		if (red > 248) {
			return 231;
		}
		return Math.round(((red - 8) / 247) * 24) + 232;
	}

	return (
		16 +
		36 * Math.round((red / 255) * 5) +
		6 * Math.round((green / 255) * 5) +
		Math.round((blue / 255) * 5)
	);
}

/**
 * The standard 16 colors, as the values nearly every terminal ships. Picking
 * the nearest of them needs actual colors to compare against.
 */
const basic16 = [
	[0, 0, 0], // black
	[128, 0, 0], // red
	[0, 128, 0], // green
	[128, 128, 0], // yellow
	[0, 0, 128], // blue
	[128, 0, 128], // magenta
	[0, 128, 128], // cyan
	[192, 192, 192], // white
	[128, 128, 128], // bright black
	[255, 0, 0], // bright red
	[0, 255, 0], // bright green
	[255, 255, 0], // bright yellow
	[0, 0, 255], // bright blue
	[255, 0, 255], // bright magenta
	[0, 255, 255], // bright cyan
	[255, 255, 255], // bright white
] as const;

/** The six levels each channel of the 256-color cube steps through. */
const cubeSteps = [0, 95, 135, 175, 215, 255] as const;

/**
 * The nearest of the basic 16, as an SGR parameter.
 *
 * Nearest by distance against the palette above, rather than by rounding each
 * channel to a bit and reading the result as a color index. Rounding to bits
 * cannot express a gray at all -- every channel rounds the same way, so the
 * only grays it can reach are black and white -- which put mid-gray on 37
 * when 37 is `#c0c0c0` and 90 is exactly `#808080`.
 *
 * The metric is the "redmean" weighting, which is a closer match to what the
 * eye does than plain squared distance for about the same arithmetic. A tie
 * goes to the lower index, which is the darker or less saturated of the two.
 *
 * @param red - The red channel, 0-255.
 * @param green - The green channel, 0-255.
 * @param blue - The blue channel, 0-255.
 * @param background - Whether the color is a background.
 * @returns The SGR parameter.
 */
function rgbToBasic(red: number, green: number, blue: number, background: boolean): number {
	let nearest = 0;
	let shortest = Infinity;

	for (let i = 0; i < basic16.length; i++) {
		const [r, g, b] = basic16[i]!;
		const mean = (red + r) / 2;
		const dr = red - r;
		const dg = green - g;
		const db = blue - b;
		const distance = (2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db;

		if (distance < shortest) {
			shortest = distance;
			nearest = i;
		}
	}

	const offset = background ? 10 : 0;
	return nearest < 8 ? 30 + nearest + offset : 90 + (nearest - 8) + offset;
}

/**
 * The color a 256-color palette index stands for: the basic 16, then a 6x6x6
 * cube whose channels step through `cubeSteps`, then a 24-step gray ramp.
 *
 * @param code - The palette index, 0-255.
 * @returns The channel values.
 */
function ansi256ToRgb(code: number): readonly [number, number, number] {
	if (code < 16) {
		return basic16[code]!;
	}

	if (code >= 232) {
		const value = (code - 232) * 10 + 8;
		return [value, value, value];
	}

	const index = code - 16;
	return [
		cubeSteps[Math.floor(index / 36)]!,
		cubeSteps[Math.floor((index % 36) / 6)]!,
		cubeSteps[index % 6]!,
	];
}

/**
 * Validates a channel or palette index.
 *
 * A color quietly rendering as something else is worse than a thrown error:
 * the sequence still writes, so the only symptom is the wrong color in a
 * terminal somebody else is looking at.
 *
 * @param value - The value to check.
 * @param what - What the value is, for the error message.
 * @returns The value.
 */
function assertByte(value: number, what: string): number {
	if (!Number.isInteger(value) || value < 0 || value > 255) {
		throw new Error(`Invalid ${what} "${value}"; expected an integer between 0 and 255`);
	}
	return value;
}
