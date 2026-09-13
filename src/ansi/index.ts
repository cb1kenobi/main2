import {
	type ColorLevel,
	type ColorSupportOptions,
	getColorLevel,
	setColorLevel,
	supportsColor,
} from './color-support.js';
import { hasAnsi, strip } from './strip.js';
import { createStyler, type Styler } from './style.js';

export { codes, type StyleName } from './codes.js';
export { type ColorLevel, type ColorSupportOptions, supportsColor } from './color-support.js';
export { hasAnsi, strip } from './strip.js';
export { type Styler, type Styles } from './style.js';

/**
 * The styler, plus the handful of things that are about the module rather than
 * about one chain.
 */
export interface Ansi extends Styler {
	/**
	 * How much color is written: `0` none, `1` the basic 16, `2` the 256-color
	 * palette, `3` truecolor. Detected from `process.stdout` and the
	 * environment on first use; assigning overrides the detection, and
	 * assigning `undefined` restores it.
	 *
	 * The level is read when text is rendered, so lowering it downsamples
	 * chains that were built before the change rather than leaving them to
	 * write sequences the terminal cannot render.
	 */
	level: ColorLevel;
	/** Whether a string contains an escape sequence. */
	hasAnsi(str: string): boolean;
	/** Removes every escape sequence from a string. */
	strip(str: string): string;
	/** Detects the color level of a stream. */
	supportsColor(opts?: ColorSupportOptions): ColorLevel;
}

/**
 * Styles terminal output, and takes the styling back out again.
 *
 * Every style name is a property that returns another styler, so styles
 * compose by reading them off one another:
 *
 * ```js
 * ansi.bold.underline('Usage:');
 * ansi.hex('#5f87af')('mycli');
 * ansi.strip(styled).length; // what it actually measures
 * ```
 *
 * Nothing here is a dependency: this is the `chalk` and `strip-ansi` that
 * a zero-dependency library cannot install.
 */
export const ansi: Ansi = Object.defineProperties(createStyler() as Ansi, {
	hasAnsi: { configurable: true, value: hasAnsi, writable: true },
	level: {
		configurable: true,
		get: getColorLevel,
		// the declared type is `ColorLevel`, but `undefined` is accepted at
		// runtime as "detect it again" -- typing it as optional would make every
		// read of `ansi.level` need a guard for a value it never returns
		set: setColorLevel as (level: ColorLevel) => void,
	},
	strip: { configurable: true, value: strip, writable: true },
	supportsColor: { configurable: true, value: supportsColor, writable: true },
});

export default ansi;
