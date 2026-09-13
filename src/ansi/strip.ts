import { ESC } from './codes.js';

/**
 * Every escape sequence a terminal might be handed, in the order the
 * alternation has to try them.
 *
 * The generic two-character form at the end would otherwise swallow the `[` of
 * a CSI sequence or the `]` of an OSC and leave the parameters behind as text,
 * so the framed sequences come first. Each framed form also accepts running to
 * the end of the string: a truncated sequence is still not printable text, and
 * leaving half of one behind would corrupt whatever is measured or wrapped
 * next.
 */
const sequences = [
	// OSC -- ESC ] ... terminated by BEL, ST, or the end of the string. Used for
	// hyperlinks and window titles, and the payload may contain `;` and spaces.
	'(?:\\u001B\\]|\\u009D)[\\s\\S]*?(?:\\u0007|\\u001B\\\\|\\u009C|$)',

	// DCS, SOS, PM, and APC -- ESC P/X/^/_ ... terminated by ST
	'(?:\\u001B[P^_X]|[\\u0090\\u0098\\u009E\\u009F])[\\s\\S]*?(?:\\u001B\\\\|\\u009C|$)',

	// CSI -- ESC [ parameters intermediates final. SGR is the one that matters
	// here, but cursor movement and erase share the shape.
	'(?:\\u001B\\[|\\u009B)[0-?]*[ -/]*(?:[@-~]|$)',

	// everything else -- ESC, optional intermediates, one final byte
	'\\u001B[ -/]*[0-~]?',
].join('|');

/**
 * Matches one escape sequence. Built fresh per call rather than shared,
 * because a `g` flagged regex carries `lastIndex` and sharing one across calls
 * makes `test()` and `exec()` answer differently depending on what ran before.
 *
 * @returns The matcher.
 */
function matcher(): RegExp {
	return new RegExp(sequences, 'g');
}

/**
 * Removes every escape sequence from a string.
 *
 * This is what makes a measured width honest: a styled string is longer than
 * it looks, and every sequence in it occupies zero columns.
 *
 * @param str - The string to strip.
 * @returns The string with no escape sequences left in it.
 */
export function strip(str: string): string {
	return str.includes(ESC) || hasC1(str) ? str.replace(matcher(), '') : str;
}

/**
 * Whether a string contains an escape sequence.
 *
 * @param str - The string to test.
 * @returns `true` when at least one sequence is present.
 */
export function hasAnsi(str: string): boolean {
	return matcher().test(str);
}

/**
 * The single-byte C1 introducers, which start a sequence without an ESC in
 * front of them. Rare, but `strip()` would otherwise have to run the full
 * matcher over every string to find out, and the common case is a string with
 * no escapes at all.
 *
 * @param str - The string to test.
 * @returns `true` when the string contains a C1 introducer.
 */
function hasC1(str: string): boolean {
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code >= 0x80 && code <= 0x9f) {
			return true;
		}
	}
	return false;
}
