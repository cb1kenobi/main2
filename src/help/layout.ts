import { stringWidth } from '../width/index.js';
import { wrap } from '../wrap/index.js';

/** One row of a two-column list: a term and what it means. */
export interface Definition {
	desc?: string;
	label: string;
}

export interface LayoutOptions {
	/** How far the labels are indented. */
	indent: number;
	/**
	 * The widest a label column is allowed to get before the descriptions start
	 * on their own lines instead. A long flag should not push every description
	 * into a gutter two columns wide.
	 */
	maxLabel: number;
	/** The columns between the label and its description. */
	gap: number;
	/** The column to wrap at. */
	width: number;
}

/**
 * Pads text to a column count, measuring columns rather than characters.
 *
 * `padEnd()` counts code units, so it pads a styled or a CJK label to the wrong
 * place -- which is the whole problem a two-column list has.
 *
 * @param text - The text to pad.
 * @param width - The column to pad to.
 * @returns The text, padded.
 */
export function pad(text: string, width: number): string {
	return text + ' '.repeat(Math.max(width - stringWidth(text), 0));
}

/**
 * Lays out a two-column list: the label on the left, its description wrapped in
 * the column to the right of it.
 *
 * A label too wide for the column takes a line of its own and its description
 * starts on the next one, which is the only way to keep the description column
 * from being squeezed to nothing by one long flag.
 *
 * @param items - The rows.
 * @param opts - Where the columns are.
 * @returns The lines.
 */
export function definitions(items: Definition[], opts: LayoutOptions): string[] {
	const { gap, indent, maxLabel, width } = opts;

	// a label wider than the column is going to take a line of its own, so it
	// does not get to widen the column for everything else: one long flag would
	// otherwise leave every short one trailing twenty spaces before its
	// description
	const widths = items.map((item) => stringWidth(item.label)).filter((w) => w <= maxLabel);
	const labelWidth = Math.max(...widths, 0);
	const column = indent + labelWidth + gap;
	const prefix = ' '.repeat(indent);

	// when there is not enough room left for a description to read as prose, the
	// two columns become one: every label takes a line and its description is
	// indented under it. Wrapping to a handful of columns is a word per line, and
	// running past the terminal's edge is worse still -- the terminal wraps it at
	// the margin and the indent is lost.
	if (width - column < MIN_DESC) {
		return stacked(items, indent, width);
	}

	const lines: string[] = [];

	for (const { desc, label } of items) {
		if (!desc) {
			lines.push(prefix + label);
			continue;
		}

		const wrapped = wrap(desc, width - column).split('\n');

		if (stringWidth(label) > labelWidth) {
			// the label does not fit its column, so it takes the line
			lines.push(prefix + label);
		} else {
			lines.push(prefix + pad(label, labelWidth) + ' '.repeat(gap) + wrapped.shift());
		}

		for (const line of wrapped) {
			lines.push(' '.repeat(column) + line);
		}
	}

	return lines;
}

/**
 * The one-column fallback: a label per line, its description under it.
 *
 * @param items - The rows.
 * @param indent - How far the labels are indented.
 * @param width - The column to wrap at.
 * @returns The lines.
 */
function stacked(items: Definition[], indent: number, width: number): string[] {
	const lines: string[] = [];
	const under = indent + 2;

	for (const { desc, label } of items) {
		lines.push(' '.repeat(indent) + label);
		if (desc) {
			lines.push(...wrap(desc, { indent: under, width }).split('\n'));
		}
	}

	return lines;
}

/**
 * The narrowest a description column may be before the list gives up on two
 * columns. Below this, wrapping is a word per line.
 */
const MIN_DESC = 20;
