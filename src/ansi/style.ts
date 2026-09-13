import { codes, sgr, type StyleName } from './codes.js';
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
	[Cache]: Map<string, Styler>;
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
		return chain(this, `ansi256:${n}`, {
			open: (level) => (level >= 2 ? sgr(`38;5;${n}`) : sgr(ansi256ToBasic(n, false))),
			close: sgr(39),
		});
	}),
	bgAnsi256: method(function (this: InternalStyler, code: number) {
		const n = assertByte(code, 'color code');
		return chain(this, `bgAnsi256:${n}`, {
			open: (level) => (level >= 2 ? sgr(`48;5;${n}`) : sgr(ansi256ToBasic(n, true))),
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
 * Extends a styler with one more part, reusing the styler already built for
 * that key. Chains are read repeatedly -- a help screen asks for
 * `ansi.bold.cyan` once per command -- and without the cache every read walks
 * a getter and allocates.
 *
 * @param parent - The styler being extended.
 * @param key - What identifies the added part within the parent.
 * @param part - The style to add.
 * @returns The extended styler.
 */
function chain(parent: InternalStyler, key: string, part: Part): Styler {
	let styler = parent[Cache].get(key);
	if (!styler) {
		styler = build([...parent[Parts], part]);
		parent[Cache].set(key, styler);
	}
	return styler;
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

	return chain(parent, `${prefix}:${r},${g},${b}`, {
		open: (level) => {
			if (level >= 3) {
				return sgr(`${prefix};2;${r};${g};${b}`);
			}
			if (level === 2) {
				return sgr(`${prefix};5;${rgbToAnsi256(r, g, b)}`);
			}
			return sgr(ansi256ToBasic(rgbToAnsi256(r, g, b), background));
		},
		close: sgr(background ? 49 : 39),
	});
}

/**
 * Wraps text in a chain's sequences.
 *
 * Two details beyond the obvious concatenation, both of which only show up in
 * composed output:
 *
 * - Close codes are shared, so text that already closed bold would leave the
 *   outer bold off for the rest of the line. Every close this chain owns is
 *   followed by its own open again.
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

	for (const part of parts) {
		const open = typeof part.open === 'string' ? part.open : part.open(level);
		openAll += open;
		closeAll = part.close + closeAll;

		if (text.includes(part.close)) {
			text = text.replaceAll(part.close, part.close + open);
		}
	}

	if (text.includes('\n')) {
		text = text.replace(/\r?\n/g, (newline) => `${closeAll}${newline}${openAll}`);
	}

	return `${openAll}${text}${closeAll}`;
}

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
 * The nearest of the basic 16, as an SGR parameter.
 *
 * Going through the 256-color index rather than straight from RGB keeps one
 * implementation of the cube math. The brightness of the strongest channel
 * decides between the normal and the bright range.
 *
 * @param code - The palette index, 0-255.
 * @param background - Whether the color is a background.
 * @returns The SGR parameter.
 */
function ansi256ToBasic(code: number, background: boolean): number {
	const offset = background ? 10 : 0;

	if (code < 8) {
		return 30 + code + offset;
	}

	if (code < 16) {
		return 90 + (code - 8) + offset;
	}

	let red: number;
	let green: number;
	let blue: number;

	if (code >= 232) {
		// the grayscale ramp, as a 0-1 fraction per channel
		red = green = blue = ((code - 232) * 10 + 8) / 255;
	} else {
		const index = code - 16;
		const remainder = index % 36;
		red = Math.floor(index / 36) / 5;
		green = Math.floor(remainder / 6) / 5;
		blue = (remainder % 6) / 5;
	}

	// 0 is black, 1 is a normal color, 2 is a bright one
	const brightness = Math.max(red, green, blue) * 2;

	if (brightness === 0) {
		return 30 + offset;
	}

	const color =
		30 + ((Math.round(blue) << 2) | (Math.round(green) << 1) | Math.round(red)) + offset;

	return brightness === 2 ? color + 60 : color;
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
