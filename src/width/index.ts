import { strip } from '../ansi/strip.js';
import { wideRanges } from './east-asian-width.js';

export { unicodeVersion, wideRanges } from './east-asian-width.js';

/**
 * Characters that print nothing and move the cursor nowhere.
 *
 * - `Mn` and `Me` are the marks that draw on top of the character before them:
 *   a combining acute, a variation selector, an enclosing keycap.
 * - `Cf` is the format characters -- the zero width space, the joiner, the
 *   bidi controls, the byte order mark.
 * - `Cc` is the C0 and C1 controls. A tab and a newline are in here, which is
 *   deliberate: neither has a width, they have an effect, and resolving that
 *   effect means knowing where on the line they are. Expand tabs and split
 *   lines before measuring.
 * - `Default_Ignorable_Code_Point` catches the rest, including the Hangul
 *   fillers and the tag characters, which fall into none of the categories
 *   above.
 *
 * These come from the runtime's own Unicode tables rather than from the
 * generated one next door, which is only needed for East Asian Width -- the one
 * property ECMAScript has no escape for.
 */
const zeroWidth = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}\p{Default_Ignorable_Code_Point}]$/u;

/**
 * A character that a terminal draws as an emoji by default, and therefore two
 * columns wide whatever its East Asian Width says.
 */
const emojiPresentation = /^\p{Emoji_Presentation}$/u;

/**
 * A character that can be drawn as an emoji when asked to be -- which the
 * presentation selector is what asks. It is a wider set than the one above and
 * includes the ASCII digits, `#`, and `*`, which is what makes a keycap
 * sequence two columns.
 */
const emoji = /^\p{Emoji}$/u;

/** Nothing outside printable ASCII, where one code unit is one column. */
const asciiOnly = /^[\x20-\x7E]*$/;

/**
 * The emoji presentation selector, which makes an emoji character before it
 * wide. Built rather than written as a literal, because the formatter turns a
 * `\u` escape into the character itself and this one is invisible.
 */
const VS16 = String.fromCodePoint(0xfe0f);

let segmenter: Intl.Segmenter | undefined;

/**
 * How many columns a string occupies in a terminal.
 *
 * Three things make this more than `str.length`:
 *
 * - Escape sequences occupy nothing, so they are stripped first.
 * - A character is not a column. `Intl.Segmenter` splits the text into grapheme
 *   clusters -- one family emoji is eleven code units, one flag is four, and
 *   each is one cluster the terminal draws once.
 * - A cluster is not a column either. An East Asian character takes two, and so
 *   does anything drawn as an emoji.
 *
 * Measure one line at a time: a tab and a newline have an effect rather than a
 * width, and both count zero here.
 *
 * @param str - The string to measure.
 * @returns The number of columns.
 */
export function stringWidth(str: string): number {
	if (asciiOnly.test(str)) {
		// the overwhelmingly common case, and no segmentation can change it
		return str.length;
	}

	const text = strip(str);
	if (asciiOnly.test(text)) {
		return text.length;
	}

	let width = 0;
	for (const cluster of graphemes(text)) {
		width += graphemeWidth(cluster);
	}
	return width;
}

/**
 * Splits a string into grapheme clusters -- what a reader would call a
 * character, and what a terminal draws as one.
 *
 * This is what keeps a wrap from cutting a flag in half. Escape sequences are
 * not stripped: a caller that needs them gone strips first, and one that is
 * wrapping styled text needs them left where they are.
 *
 * @param str - The string to split.
 * @returns The clusters, in order.
 */
export function graphemes(str: string): string[] {
	segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
	const clusters: string[] = [];
	for (const { segment } of segmenter.segment(str)) {
		clusters.push(segment);
	}
	return clusters;
}

/**
 * How many columns one grapheme cluster occupies.
 *
 * The cluster's first character decides, because everything after it in a
 * cluster is something drawn on top of or joined to that first one. The
 * exception is the emoji presentation selector, which is what turns a
 * text-presentation character into a two-column emoji: `U+2764` is a narrow
 * heavy heart, and `U+2764 U+FE0F` is the emoji.
 *
 * The selector only widens something that can be an emoji in the first place.
 * It is a nonspacing mark, so a cluster is free to carry one for reasons that
 * have nothing to do with emoji, and `a U+FE0F` is still one column.
 *
 * @param cluster - The cluster to measure. A string of more than one cluster is
 * measured as whichever one it starts with.
 * @returns 0, 1, or 2.
 */
export function graphemeWidth(cluster: string): number {
	const first = cluster.codePointAt(0);

	if (first === undefined) {
		return 0;
	}

	const base = String.fromCodePoint(first);

	// a cluster of nothing but marks -- a lone selector, an orphaned combining
	// accent -- draws nothing, selector or not
	if (zeroWidth.test(base)) {
		return 0;
	}

	if (cluster.includes(VS16) && emoji.test(base)) {
		return 2;
	}

	return charWidth(first);
}

/**
 * How many columns one code point occupies on its own.
 *
 * Callers measuring text want `stringWidth()`; this is the lookup underneath
 * it, and it knows nothing about the cluster a code point may belong to.
 *
 * @param codePoint - The code point to measure.
 * @returns 0, 1, or 2.
 */
export function charWidth(codePoint: number): number {
	// ASCII first: it is most of every string a CLI prints
	if (codePoint >= 0x20 && codePoint < 0x7f) {
		return 1;
	}

	const char = String.fromCodePoint(codePoint);

	if (zeroWidth.test(char)) {
		return 0;
	}

	if (emojiPresentation.test(char) || isWide(codePoint)) {
		return 2;
	}

	return 1;
}

/**
 * Whether a code point's East Asian Width is Wide or Fullwidth, by binary
 * search over the generated ranges.
 *
 * @param codePoint - The code point to look up.
 * @returns `true` when it occupies two columns.
 */
function isWide(codePoint: number): boolean {
	let low = 0;
	let high = wideRanges.length / 2 - 1;

	while (low <= high) {
		const mid = (low + high) >> 1;
		const start = wideRanges[mid * 2]!;
		const end = wideRanges[mid * 2 + 1]!;

		if (codePoint < start) {
			high = mid - 1;
		} else if (codePoint > end) {
			low = mid + 1;
		} else {
			return true;
		}
	}

	return false;
}
