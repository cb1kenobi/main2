import { type PropertyName, PROPERTIES } from './properties.js';
import { parts, StyleError } from './value.js';

/**
 * Shorthands, expanded into longhands before anything else looks at them.
 *
 * A table rather than a parser per shorthand. Every one of these is either "one
 * to four values in the CSS edge order" or "a fixed list of parts" -- writing
 * each as its own function would be the same twenty lines eight times, and the
 * thing most likely to drift is the edge order, which is worth having in exactly
 * one place.
 *
 * Not having shorthands at all was the alternative. It is less code and it makes
 * a stylesheet miserable to write: `padding: 1 2` is the spelling everybody
 * knows, and four longhands to say it is four chances to get one wrong.
 */

/** The CSS edge order, which is the thing worth writing down once. */
type Edges = [top: PropertyName, right: PropertyName, bottom: PropertyName, left: PropertyName];

/**
 * One to four values, top-right-bottom-left, filled in the way CSS fills them:
 * one value is every edge, two are vertical then horizontal, three leave the
 * left to match the right.
 *
 * @param values - What was written.
 * @param edges - The longhands, in edge order.
 * @param name - The shorthand, for the message.
 * @returns The longhand declarations, still as source text.
 */
function edges(values: string[], edgeNames: Edges, name: string): [PropertyName, string][] {
	const [top, right, bottom, left] = edgeNames;

	switch (values.length) {
		case 1:
			return [
				[top, values[0]],
				[right, values[0]],
				[bottom, values[0]],
				[left, values[0]],
			];
		case 2:
			return [
				[top, values[0]],
				[right, values[1]],
				[bottom, values[0]],
				[left, values[1]],
			];
		case 3:
			return [
				[top, values[0]],
				[right, values[1]],
				[bottom, values[2]],
				[left, values[1]],
			];
		case 4:
			return [
				[top, values[0]],
				[right, values[1]],
				[bottom, values[2]],
				[left, values[3]],
			];
		default:
			throw new StyleError(`Invalid ${name}: expected one to four values`);
	}
}

const PADDING: Edges = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
const MARGIN: Edges = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'];
const INSET: Edges = ['top', 'right', 'bottom', 'left'];

type Expander = (values: string[]) => [PropertyName, string][];

const SHORTHANDS: Record<string, Expander> = {
	padding: (v) => edges(v, PADDING, 'padding'),
	margin: (v) => edges(v, MARGIN, 'margin'),
	inset: (v) => edges(v, INSET, 'inset'),

	gap: (v) => {
		if (v.length === 1) {
			return [
				['rowGap', v[0]],
				['columnGap', v[0]],
			];
		}
		if (v.length === 2) {
			return [
				['rowGap', v[0]],
				['columnGap', v[1]],
			];
		}
		throw new StyleError('Invalid gap: expected one or two values');
	},

	/**
	 * `border: <style> <color>`, in either order and either alone.
	 *
	 * No width. A terminal border is one cell and cannot be anything else, so a
	 * width would be a number with exactly one legal value.
	 */
	// `none` is the one ambiguous token: a valid border-style *and* a valid way to
	// spell "no colour". Style wins, because the first position is the style's
	border: (v) => {
		if (v.length === 0 || v.length > 2) {
			throw new StyleError('Invalid border: expected a style, a colour, or both');
		}

		const out: [PropertyName, string][] = [];
		let sawStyle = false;
		let sawColor = false;

		for (const part of v) {
			let isStyle = false;
			try {
				PROPERTIES.borderStyle.parse(part);
				isStyle = true;
			} catch {
				isStyle = false;
			}

			if (isStyle && !sawStyle) {
				sawStyle = true;
				out.push(['borderStyle', part]);
				continue;
			}

			if (sawColor) {
				throw new StyleError(`Invalid border "${v.join(' ')}": two colours`);
			}
			// left for the colour parser to reject, so the message names the colour
			// rather than the shorthand
			sawColor = true;
			out.push(['borderColor', part]);
		}

		// a border given only a colour is still a border, which is the one thing
		// CSS gets wrong here: `border-color` alone draws nothing
		if (!sawStyle) {
			out.unshift(['borderStyle', 'single']);
		}

		// a shorthand resets every longhand it covers, including the ones this use
		// did not mention. That is what makes `border: single` after a
		// `border-color: red` mean what it looks like it means
		if (!sawColor) {
			out.push(['borderColor', 'default']);
		}

		return out;
	},

	/**
	 * `flex: <grow> <shrink> <basis>`, with the CSS shorthand's defaults.
	 *
	 * `flex: 1` means grow 1, shrink 1, basis 0 -- not basis auto. That surprises
	 * people every time and it is the behavior everyone's muscle memory expects,
	 * so it is what this does.
	 */
	flex: (v) => {
		if (v.length === 0 || v.length > 3) {
			throw new StyleError('Invalid flex: expected one to three values');
		}
		if (v.length === 1 && v[0].toLowerCase() === 'none') {
			return [
				['flexGrow', '0'],
				['flexShrink', '0'],
				['flexBasis', 'auto'],
			];
		}
		return [
			['flexGrow', v[0]],
			['flexShrink', v[1] ?? '1'],
			['flexBasis', v[2] ?? '0'],
		];
	},

	'flex-flow': (v) => {
		if (v.length === 0 || v.length > 2) {
			throw new StyleError('Invalid flex-flow: expected a direction, a wrap, or both');
		}
		// the omitted half is reset rather than left alone, for the same reason
		// `border` resets its colour
		return [
			['flexDirection', v[0]],
			['flexWrap', v[1] ?? 'nowrap'],
		];
	},
};

/** Whether a name is a shorthand rather than a property. */
export function isShorthand(name: string): boolean {
	return name.trim().toLowerCase() in SHORTHANDS;
}

/** Every shorthand, for documentation and for tests that walk them. */
export const SHORTHAND_NAMES: readonly string[] = Object.keys(SHORTHANDS);

/**
 * Expands a shorthand into the declarations it stands for, still as source text
 * -- the longhand parsers do the reading, so a bad value is reported against the
 * property it belongs to rather than against the shorthand.
 *
 * @param name - The shorthand.
 * @param value - The value, as written.
 * @returns The longhand declarations.
 */
export function expandShorthand(name: string, value: string): [PropertyName, string][] {
	const expander = SHORTHANDS[name.trim().toLowerCase()];
	if (!expander) {
		throw new StyleError(`"${name}" is not a shorthand`);
	}
	return expander(parts(value));
}
