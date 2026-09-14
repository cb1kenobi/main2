import { type Color, DEFAULT_COLOR } from '../canvas/style.js';
import {
	AUTO,
	cells,
	type Length,
	parseColor,
	parseCount,
	parseFactor,
	parseKeyword,
	parseLength,
	StyleError,
} from './value.js';

/**
 * The property set: every property, what it means, what it starts as, and
 * whether it inherits.
 *
 * "Watered down" means dropping what a grid of character cells cannot express.
 * It does not mean dropping the model. Out permanently, because there is no way
 * to draw them: `font-family` and `font-size` (the cell size is the user's),
 * `border-radius`, `box-shadow`, transforms, and any fractional length.
 *
 * The nearest analogues survive under their own names -- weight is `bold`, and
 * its opposite is `dim`, which is a terminal attribute rather than a point on a
 * weight axis. VT100 double-width and double-height lines are the one real font
 * size a terminal has, and almost nothing implements them; noted and skipped.
 *
 * This table is the single source of truth. Everything downstream in Phase 3 --
 * the cascade, inheritance, invalidation, animation -- reads it rather than
 * carrying its own list, so a property is added in one place.
 */

export type Display = 'flex' | 'none';
export type FlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse';
export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';
export type JustifyContent =
	| 'flex-start'
	| 'flex-end'
	| 'center'
	| 'space-between'
	| 'space-around'
	| 'space-evenly';
export type AlignItems = 'flex-start' | 'flex-end' | 'center' | 'stretch';
export type AlignSelf = AlignItems | 'auto';
export type Position = 'relative' | 'absolute';
export type Overflow = 'visible' | 'hidden' | 'scroll';
export type TextAlign = 'left' | 'center' | 'right';
export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';
export type WhiteSpace = 'normal' | 'pre' | 'nowrap';
export type TextOverflow = 'clip' | 'ellipsis' | 'ellipsis-start' | 'ellipsis-middle';

/**
 * A border's character set, rather than a rendering mode.
 *
 * This is the one place the property set is terminal-shaped rather than
 * CSS-shaped: `solid` and `dashed` mean nothing here, and which box-drawing
 * characters to use means everything. `ascii` is the fallback for a terminal
 * that cannot be trusted with anything else.
 */
export type BorderStyle = 'none' | 'single' | 'double' | 'round' | 'bold' | 'ascii';

/** Every property, in the order they are documented. */
export interface Style {
	// layout
	display: Display;
	flexDirection: FlexDirection;
	flexGrow: number;
	flexShrink: number;
	flexBasis: Length;
	flexWrap: FlexWrap;
	justifyContent: JustifyContent;
	alignItems: AlignItems;
	alignSelf: AlignSelf;
	rowGap: number;
	columnGap: number;

	// box
	width: Length;
	height: Length;
	minWidth: Length;
	minHeight: Length;
	maxWidth: Length;
	maxHeight: Length;
	paddingTop: number;
	paddingRight: number;
	paddingBottom: number;
	paddingLeft: number;
	marginTop: Length;
	marginRight: Length;
	marginBottom: Length;
	marginLeft: Length;
	borderStyle: BorderStyle;
	borderColor: Color;

	// position
	position: Position;
	top: Length;
	right: Length;
	bottom: Length;
	left: Length;
	zIndex: number;
	overflow: Overflow;

	// text
	color: Color;
	backgroundColor: Color;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
	strikethrough: boolean;
	overline: boolean;
	inverse: boolean;
	textAlign: TextAlign;
	textTransform: TextTransform;
	textOverflow: TextOverflow;
	whiteSpace: WhiteSpace;
}

export type PropertyName = keyof Style;

interface Definition<K extends PropertyName = PropertyName> {
	/**
	 * Whether a child gets this from its parent when nothing else says
	 * otherwise. Follows CSS: text properties inherit, box and layout properties
	 * do not. It is the rule people already know, and it is most of why a cascade
	 * beats props -- setting `color` on a container and having the text inside
	 * pick it up is the single most common thing anyone wants.
	 */
	readonly inherits: boolean;
	readonly initial: Style[K];
	/** Reads the property's value from source. Throws `StyleError` on nonsense. */
	readonly parse: (input: string) => Style[K];
}

const flag = (name: string) => (input: string) =>
	parseKeyword(input, ['true', 'false'] as const, name) === 'true';

/** The table. */
export const PROPERTIES: { readonly [K in PropertyName]: Definition<K> } = {
	display: {
		inherits: false,
		initial: 'flex',
		parse: (v) => parseKeyword(v, ['flex', 'none'] as const, 'display'),
	},
	flexDirection: {
		inherits: false,
		initial: 'row',
		parse: (v) =>
			parseKeyword(
				v,
				['row', 'row-reverse', 'column', 'column-reverse'] as const,
				'flex-direction'
			),
	},
	flexGrow: { inherits: false, initial: 0, parse: (v) => parseFactor(v, 'flex-grow') },
	flexShrink: { inherits: false, initial: 1, parse: (v) => parseFactor(v, 'flex-shrink') },
	flexBasis: { inherits: false, initial: AUTO, parse: parseLength },
	flexWrap: {
		inherits: false,
		initial: 'nowrap',
		parse: (v) => parseKeyword(v, ['nowrap', 'wrap', 'wrap-reverse'] as const, 'flex-wrap'),
	},
	justifyContent: {
		inherits: false,
		initial: 'flex-start',
		parse: (v) =>
			parseKeyword(
				v,
				[
					'flex-start',
					'flex-end',
					'center',
					'space-between',
					'space-around',
					'space-evenly',
				] as const,
				'justify-content'
			),
	},
	alignItems: {
		inherits: false,
		initial: 'stretch',
		parse: (v) =>
			parseKeyword(v, ['flex-start', 'flex-end', 'center', 'stretch'] as const, 'align-items'),
	},
	alignSelf: {
		inherits: false,
		initial: 'auto',
		parse: (v) =>
			parseKeyword(
				v,
				['auto', 'flex-start', 'flex-end', 'center', 'stretch'] as const,
				'align-self'
			),
	},
	rowGap: { inherits: false, initial: 0, parse: (v) => parseCount(v, 'row-gap') },
	columnGap: { inherits: false, initial: 0, parse: (v) => parseCount(v, 'column-gap') },

	width: { inherits: false, initial: AUTO, parse: parseLength },
	height: { inherits: false, initial: AUTO, parse: parseLength },
	minWidth: { inherits: false, initial: AUTO, parse: parseLength },
	minHeight: { inherits: false, initial: AUTO, parse: parseLength },
	maxWidth: { inherits: false, initial: AUTO, parse: parseLength },
	maxHeight: { inherits: false, initial: AUTO, parse: parseLength },
	paddingTop: { inherits: false, initial: 0, parse: (v) => parseCount(v, 'padding') },
	paddingRight: { inherits: false, initial: 0, parse: (v) => parseCount(v, 'padding') },
	paddingBottom: { inherits: false, initial: 0, parse: (v) => parseCount(v, 'padding') },
	paddingLeft: { inherits: false, initial: 0, parse: (v) => parseCount(v, 'padding') },
	// margins take a length rather than a count, because `auto` is how a box is
	// centred and how it is pushed to one end -- the one place a negative or
	// automatic value earns itself
	marginTop: { inherits: false, initial: cells(0), parse: parseLength },
	marginRight: { inherits: false, initial: cells(0), parse: parseLength },
	marginBottom: { inherits: false, initial: cells(0), parse: parseLength },
	marginLeft: { inherits: false, initial: cells(0), parse: parseLength },
	borderStyle: {
		inherits: false,
		initial: 'none',
		parse: (v) =>
			parseKeyword(
				v,
				['none', 'single', 'double', 'round', 'bold', 'ascii'] as const,
				'border-style'
			),
	},
	borderColor: { inherits: false, initial: DEFAULT_COLOR, parse: parseColor },

	position: {
		inherits: false,
		initial: 'relative',
		parse: (v) => parseKeyword(v, ['relative', 'absolute'] as const, 'position'),
	},
	top: { inherits: false, initial: AUTO, parse: parseLength },
	right: { inherits: false, initial: AUTO, parse: parseLength },
	bottom: { inherits: false, initial: AUTO, parse: parseLength },
	left: { inherits: false, initial: AUTO, parse: parseLength },
	zIndex: {
		inherits: false,
		initial: 0,
		parse: (v) => {
			const value = Number(v.trim());
			if (v.trim() === '' || !Number.isInteger(value)) {
				throw new StyleError(`Invalid z-index "${v}": expected a whole number`);
			}
			return value;
		},
	},
	overflow: {
		inherits: false,
		initial: 'visible',
		parse: (v) => parseKeyword(v, ['visible', 'hidden', 'scroll'] as const, 'overflow'),
	},

	color: { inherits: true, initial: DEFAULT_COLOR, parse: parseColor },
	backgroundColor: { inherits: true, initial: DEFAULT_COLOR, parse: parseColor },
	bold: { inherits: true, initial: false, parse: flag('bold') },
	dim: { inherits: true, initial: false, parse: flag('dim') },
	italic: { inherits: true, initial: false, parse: flag('italic') },
	underline: { inherits: true, initial: false, parse: flag('underline') },
	strikethrough: { inherits: true, initial: false, parse: flag('strikethrough') },
	overline: { inherits: true, initial: false, parse: flag('overline') },
	inverse: { inherits: true, initial: false, parse: flag('inverse') },
	textAlign: {
		inherits: true,
		initial: 'left',
		parse: (v) => parseKeyword(v, ['left', 'center', 'right'] as const, 'text-align'),
	},
	textTransform: {
		inherits: true,
		initial: 'none',
		parse: (v) =>
			parseKeyword(v, ['none', 'uppercase', 'lowercase', 'capitalize'] as const, 'text-transform'),
	},
	textOverflow: {
		inherits: true,
		initial: 'clip',
		parse: (v) =>
			parseKeyword(
				v,
				['clip', 'ellipsis', 'ellipsis-start', 'ellipsis-middle'] as const,
				'text-overflow'
			),
	},
	whiteSpace: {
		inherits: true,
		initial: 'normal',
		parse: (v) => parseKeyword(v, ['normal', 'pre', 'nowrap'] as const, 'white-space'),
	},
};

/** Every property name, for anything that has to walk the whole set. */
export const PROPERTY_NAMES: readonly PropertyName[] = Object.keys(PROPERTIES) as PropertyName[];

/** The properties a child takes from its parent when nothing else says otherwise. */
export const INHERITED: readonly PropertyName[] = PROPERTY_NAMES.filter(
	(name) => PROPERTIES[name].inherits
);

/**
 * `font-weight: bold` is the spelling people reach for, and `bold: true` is the
 * property. Rather than refuse the familiar one, these map onto it.
 */
const WEIGHT_TO_FLAG: Record<string, PropertyName> = {
	bold: 'bold',
	dim: 'dim',
};

/**
 * Properties whose CSS name is not a simple kebab-case of the property, or that
 * are spelled differently here because the terminal version is a different idea.
 */
const ALIASES: Record<string, PropertyName | ((value: string) => [PropertyName, string][])> = {
	'font-weight': (value) => {
		const key = value.trim().toLowerCase();
		if (key === 'normal') {
			return [
				['bold', 'false'],
				['dim', 'false'],
			];
		}
		const flagName = WEIGHT_TO_FLAG[key];
		if (!flagName) {
			throw new StyleError(
				`Invalid font-weight "${value}": a terminal has bold, dim, and normal, and no axis between them`
			);
		}
		return [[flagName, 'true']];
	},
	'font-style': (value) => {
		const key = value.trim().toLowerCase();
		if (key === 'normal') {
			return [['italic', 'false']];
		}
		if (key === 'italic' || key === 'oblique') {
			return [['italic', 'true']];
		}
		throw new StyleError(`Invalid font-style "${value}": expected normal or italic`);
	},
	'text-decoration': (value) => {
		const wanted = new Set(value.trim().toLowerCase().split(/\s+/));
		const known: [PropertyName, string][] = [
			['underline', String(wanted.has('underline'))],
			['strikethrough', String(wanted.has('line-through') || wanted.has('strikethrough'))],
			['overline', String(wanted.has('overline'))],
		];
		for (const word of wanted) {
			if (!['none', 'underline', 'line-through', 'strikethrough', 'overline'].includes(word)) {
				throw new StyleError(`Invalid text-decoration "${value}"`);
			}
		}
		return known;
	},
};

/** `background-color` -> `backgroundColor`. */
function camel(name: string): string {
	return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** `backgroundColor` -> `background-color`, for messages and for the reverse map. */
export function kebab(name: PropertyName): string {
	return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * Turns one declaration into the longhand properties it sets.
 *
 * Shorthands are expanded by `expandShorthand()` before this is reached; what
 * arrives here is either a longhand or one of the aliases above.
 *
 * @param name - The property, in CSS spelling or camelCase.
 * @param value - The value, as written.
 * @returns The longhand properties and their parsed values.
 */
export function parseDeclaration(name: string, value: string): [PropertyName, unknown][] {
	const alias = ALIASES[name.trim().toLowerCase()];
	if (alias) {
		const pairs: [PropertyName, string][] =
			typeof alias === 'function' ? alias(value) : [[alias, value]];
		return pairs.map(([prop, raw]) => [prop, PROPERTIES[prop].parse(raw)]);
	}

	const key = camel(name.trim()) as PropertyName;
	const definition = PROPERTIES[key];
	if (!definition) {
		throw new StyleError(`Unknown property "${name}"`);
	}

	return [[key, definition.parse(value)]];
}

/**
 * A style with every property at its initial value.
 *
 * @returns The style.
 */
export function initialStyle(): Style {
	const style = {} as Record<PropertyName, unknown>;
	for (const name of PROPERTY_NAMES) {
		style[name] = PROPERTIES[name].initial;
	}
	return style as Style;
}

/**
 * A style for a child, given its parent's: inherited properties carried down,
 * everything else at its initial value.
 *
 * @param parent - The parent's resolved style.
 * @returns The starting point for the child, before anything is cascaded onto it.
 */
export function inheritFrom(parent: Style): Style {
	const style = initialStyle() as Record<PropertyName, unknown>;
	for (const name of INHERITED) {
		style[name] = parent[name];
	}
	return style as Style;
}
