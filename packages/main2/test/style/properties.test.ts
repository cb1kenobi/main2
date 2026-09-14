import { DEFAULT_COLOR, palette, rgb } from '../../src/canvas/index.js';
import {
	AUTO,
	cells,
	declare,
	expandShorthand,
	INHERITED,
	inheritFrom,
	initialStyle,
	isKnownProperty,
	isShorthand,
	kebab,
	parseColor,
	parseDeclaration,
	parseLength,
	percent,
	PROPERTIES,
	PROPERTY_NAMES,
	type PropertyName,
	readDeclarations,
	SHORTHAND_NAMES,
	StyleError,
} from '../../src/style/index.js';
import { describe, expect, it } from 'vitest';

describe('the property table', () => {
	it('should give every property an initial value and an inheritance answer', () => {
		for (const name of PROPERTY_NAMES) {
			const definition = PROPERTIES[name];
			expect(definition, name).toBeDefined();
			expect(typeof definition.inherits, name).toBe('boolean');
			expect(definition.initial, name).toBeDefined();
			expect(typeof definition.parse, name).toBe('function');
		}
	});

	it('should round-trip every initial value through its own parser', () => {
		// a table whose initial value its own parser would reject is a table that
		// disagrees with itself, and nothing else would catch it
		for (const name of PROPERTY_NAMES) {
			const { initial, parse } = PROPERTIES[name];
			const written = writeValue(initial);
			if (written === undefined) {
				continue;
			}
			expect(parse(written), `${name} does not round-trip through "${written}"`).toEqual(initial);
		}
	});

	it('should inherit the text properties and nothing else', () => {
		// the CSS rule, because it is the one people already know
		expect([...INHERITED].sort()).toEqual(
			[
				'backgroundColor',
				'bold',
				'color',
				'dim',
				'inverse',
				'italic',
				'overline',
				'strikethrough',
				'textAlign',
				'textOverflow',
				'textTransform',
				'underline',
				'whiteSpace',
			].sort()
		);
	});

	it('should not inherit anything that decides a box', () => {
		for (const name of ['width', 'height', 'paddingTop', 'flexGrow', 'position', 'borderStyle']) {
			expect(PROPERTIES[name as PropertyName].inherits, name).toBe(false);
		}
	});

	it('should have no property a terminal cannot draw', () => {
		for (const gone of ['fontFamily', 'fontSize', 'borderRadius', 'boxShadow', 'opacity']) {
			expect(PROPERTY_NAMES).not.toContain(gone);
		}
	});

	it('should convert names back to their CSS spelling', () => {
		expect(kebab('backgroundColor')).toBe('background-color');
		expect(kebab('flexDirection')).toBe('flex-direction');
		expect(kebab('color')).toBe('color');
	});
});

/** A value written the way somebody would write it, or `undefined` if it cannot be. */
function writeValue(value: unknown): string | undefined {
	if (typeof value === 'boolean') {
		return String(value);
	}
	if (typeof value === 'number') {
		return value === DEFAULT_COLOR ? 'default' : String(value);
	}
	if (typeof value === 'string') {
		return value;
	}
	if (value && typeof value === 'object' && 'type' in value) {
		const length = value as { type: string; value?: number };
		if (length.type === 'auto') {
			return 'auto';
		}
		if (length.type === 'cells') {
			return String(length.value);
		}
		if (length.type === 'percent') {
			return `${length.value}%`;
		}
	}
	return undefined;
}

describe('lengths', () => {
	it('should read a bare number as cells', () => {
		expect(parseLength('3')).toEqual(cells(3));
		expect(parseLength(' 12 ')).toEqual(cells(12));
	});

	it('should accept ch as a synonym', () => {
		expect(parseLength('4ch')).toEqual(cells(4));
	});

	it('should read a percentage', () => {
		expect(parseLength('50%')).toEqual(percent(50));
	});

	it('should read auto', () => {
		expect(parseLength('auto')).toEqual(AUTO);
	});

	it('should accept a negative length, because a margin may be one', () => {
		expect(parseLength('-2')).toEqual(cells(-2));
	});

	it('should refuse a fractional length', () => {
		// a terminal cannot draw half a cell, and rounding silently is how a layout
		// ends up a column out with nobody able to say which declaration did it
		expect(() => parseLength('1.5')).toThrow(/whole number of cells/);
	});

	it('should refuse nonsense', () => {
		expect(() => parseLength('')).toThrow(StyleError);
		expect(() => parseLength('wide')).toThrow(/Invalid length/);
		expect(() => parseLength('%')).toThrow(/Invalid percentage/);
		// Number('') is 0 and Number(' ') is 0, which is how an empty value turns
		// into a real-looking length. The parser's data types learned this too
		expect(() => parseLength('  ')).toThrow(StyleError);
		expect(() => parseLength('ch')).toThrow(StyleError);
	});
});

describe('colours', () => {
	it('should read the sixteen by name', () => {
		expect(parseColor('red')).toBe(palette(1));
		expect(parseColor('BrightBlue')).toBe(palette(12));
		expect(parseColor('grey')).toBe(parseColor('gray'));
	});

	it('should read hex in both lengths', () => {
		expect(parseColor('#ff8800')).toBe(rgb(255, 136, 0));
		expect(parseColor('#f80')).toBe(rgb(255, 136, 0));
	});

	it('should read rgb()', () => {
		expect(parseColor('rgb(1, 2, 3)')).toBe(rgb(1, 2, 3));
		expect(parseColor('rgb(1 2 3)')).toBe(rgb(1, 2, 3));
	});

	it('should read a palette index', () => {
		expect(parseColor('ansi(200)')).toBe(palette(200));
		expect(parseColor('palette(0)')).toBe(palette(0));
	});

	it('should read the terminal default', () => {
		expect(parseColor('default')).toBe(DEFAULT_COLOR);
		expect(parseColor('transparent')).toBe(DEFAULT_COLOR);
	});

	it('should keep a named colour as a palette index rather than an rgb value', () => {
		// the basic sixteen are whatever the user's terminal theme says they are,
		// and resolving `red` to a specific rgb overrides a choice already made
		expect(parseColor('red')).toBeLessThan(16);
	});

	it('should refuse an out-of-range channel or index', () => {
		expect(() => parseColor('rgb(0, 0, 300)')).toThrow(/out of range/);
		expect(() => parseColor('ansi(256)')).toThrow(/out of range/);
	});

	it('should refuse nonsense', () => {
		expect(() => parseColor('reddish')).toThrow(/Invalid colour/);
		expect(() => parseColor('#gg0000')).toThrow(/Invalid colour/);
	});
});

describe('declarations', () => {
	it('should accept both spellings of a name', () => {
		expect(parseDeclaration('background-color', 'red')).toEqual([['backgroundColor', palette(1)]]);
		expect(parseDeclaration('backgroundColor', 'red')).toEqual([['backgroundColor', palette(1)]]);
	});

	it('should refuse an empty value rather than reading it as zero', () => {
		for (const [name, value] of [
			['padding-top', ''],
			['flex-grow', ''],
			['z-index', ''],
			['width', ''],
			['row-gap', '   '],
		] as const) {
			expect(() => parseDeclaration(name, value), `${name}: "${value}"`).toThrow(StyleError);
		}
	});

	it('should refuse an unknown property by name', () => {
		expect(() => parseDeclaration('font-family', 'monospace')).toThrow(/Unknown property/);
	});

	it('should map font-weight onto the attributes a terminal has', () => {
		expect(parseDeclaration('font-weight', 'bold')).toEqual([['bold', true]]);
		expect(parseDeclaration('font-weight', 'dim')).toEqual([['dim', true]]);
		expect(parseDeclaration('font-weight', 'normal')).toEqual([
			['bold', false],
			['dim', false],
		]);
	});

	it('should refuse a numeric font-weight', () => {
		// there is no axis between bold and normal to put 600 on
		expect(() => parseDeclaration('font-weight', '600')).toThrow(/bold, dim, and normal/);
	});

	it('should map font-style and text-decoration', () => {
		expect(parseDeclaration('font-style', 'italic')).toEqual([['italic', true]]);
		expect(parseDeclaration('text-decoration', 'underline line-through')).toEqual([
			['underline', true],
			['strikethrough', true],
			['overline', false],
		]);
	});

	it('should report the property that could not take the value', () => {
		expect(() => parseDeclaration('width', 'wide')).toThrow(/Invalid length/);
		expect(() => parseDeclaration('display', 'block')).toThrow(/expected one of flex, none/);
	});
});

describe('shorthands', () => {
	it('should name every shorthand it expands', () => {
		for (const name of SHORTHAND_NAMES) {
			expect(isShorthand(name), name).toBe(true);
		}
		expect(isShorthand('color')).toBe(false);
	});

	it('should fill padding the way CSS fills it', () => {
		expect(expandShorthand('padding', '1')).toEqual([
			['paddingTop', '1'],
			['paddingRight', '1'],
			['paddingBottom', '1'],
			['paddingLeft', '1'],
		]);
		expect(expandShorthand('padding', '1 2')).toEqual([
			['paddingTop', '1'],
			['paddingRight', '2'],
			['paddingBottom', '1'],
			['paddingLeft', '2'],
		]);
		expect(expandShorthand('padding', '1 2 3')).toEqual([
			['paddingTop', '1'],
			['paddingRight', '2'],
			['paddingBottom', '3'],
			['paddingLeft', '2'],
		]);
		expect(expandShorthand('padding', '1 2 3 4')).toEqual([
			['paddingTop', '1'],
			['paddingRight', '2'],
			['paddingBottom', '3'],
			['paddingLeft', '4'],
		]);
	});

	it('should refuse more than four edges', () => {
		expect(() => expandShorthand('padding', '1 2 3 4 5')).toThrow(/one to four/);
	});

	it('should split gap into rows and columns', () => {
		expect(expandShorthand('gap', '2')).toEqual([
			['rowGap', '2'],
			['columnGap', '2'],
		]);
		expect(expandShorthand('gap', '1 3')).toEqual([
			['rowGap', '1'],
			['columnGap', '3'],
		]);
	});

	it('should read a border in either order', () => {
		expect(declare({ border: 'double red' }).borderStyle).toBe('double');
		expect(declare({ border: 'red double' }).borderColor).toBe(palette(1));
	});

	it('should draw a border given only a colour', () => {
		// CSS gets this wrong: `border-color` alone draws nothing
		const style = declare({ border: 'red' });
		expect(style.borderStyle).toBe('single');
		expect(style.borderColor).toBe(palette(1));
	});

	it('should give flex the defaults everyone expects', () => {
		const style = declare({ flex: '1' });
		expect(style.flexGrow).toBe(1);
		expect(style.flexShrink).toBe(1);
		// basis 0, not auto -- which surprises people every time and is what their
		// muscle memory expects
		expect(style.flexBasis).toEqual(cells(0));
	});

	it('should read flex: none', () => {
		const style = declare({ flex: 'none' });
		expect([style.flexGrow, style.flexShrink, style.flexBasis]).toEqual([0, 0, AUTO]);
	});

	it('should keep a bracketed value together when splitting', () => {
		const style = declare({ border: 'single rgb(1, 2, 3)' });
		expect(style.borderColor).toBe(rgb(1, 2, 3));
	});

	it('should report against the longhand that could not take the value', () => {
		// `padding: 1 nonsense` is wrong at padding-right, and saying so is more
		// use than saying the shorthand failed
		expect(() => declare({ padding: '1 nonsense' })).toThrow(/Invalid padding/);
	});
});

describe('declare', () => {
	it('should start from the initial values', () => {
		const style = declare();
		expect(style).toEqual(initialStyle());
		expect(style.display).toBe('flex');
		expect(style.width).toEqual(AUTO);
		expect(style.color).toBe(DEFAULT_COLOR);
		expect(style.flexShrink).toBe(1);
	});

	it('should apply declarations over them', () => {
		const style = declare({ color: 'red', padding: '1 2', 'flex-grow': '2' });
		expect(style.color).toBe(palette(1));
		expect(style.paddingLeft).toBe(2);
		expect(style.paddingTop).toBe(1);
		expect(style.flexGrow).toBe(2);
		// everything else is untouched
		expect(style.display).toBe('flex');
	});

	it('should let a later declaration win over an earlier one', () => {
		const style = declare({ padding: '1', 'padding-left': '5' });
		expect(style.paddingLeft).toBe(5);
		expect(style.paddingRight).toBe(1);
	});

	it('should carry the inherited properties down from a parent', () => {
		const parent = declare({ color: 'red', padding: '4', bold: 'true' });
		const child = declare({}, parent);

		expect(child.color).toBe(palette(1));
		expect(child.bold).toBe(true);
		// a box is not inherited
		expect(child.paddingTop).toBe(0);
	});

	it('should let a child override what it inherited', () => {
		const parent = declare({ color: 'red' });
		const child = declare({ color: 'blue' }, parent);
		expect(child.color).toBe(palette(4));
		expect(parent.color).toBe(palette(1));
	});
});

describe('inheritFrom', () => {
	it('should take only the inherited properties', () => {
		const parent = declare({ color: 'green', width: '10', italic: 'true' });
		const child = inheritFrom(parent);

		expect(child.color).toBe(palette(2));
		expect(child.italic).toBe(true);
		expect(child.width).toEqual(AUTO);
	});

	it('should not share objects with the parent', () => {
		const parent = declare({ width: '10' });
		const child = inheritFrom(parent);
		expect(child.width).not.toBe(parent.width);
	});
});

describe('isKnownProperty', () => {
	it('should recognise longhands, shorthands, and aliases', () => {
		expect(isKnownProperty('color')).toBe(true);
		expect(isKnownProperty('background-color')).toBe(true);
		expect(isKnownProperty('padding')).toBe(true);
		expect(isKnownProperty('font-weight')).toBe(true);
	});

	it('should not recognise what a terminal cannot draw', () => {
		expect(isKnownProperty('font-size')).toBe(false);
		expect(isKnownProperty('border-radius')).toBe(false);
		expect(isKnownProperty('nonsense')).toBe(false);
	});
});

describe('readDeclarations', () => {
	it('should return only what was declared', () => {
		const read = readDeclarations({ color: 'red', gap: '1 2' });
		expect(Object.keys(read).sort()).toEqual(['color', 'columnGap', 'rowGap']);
	});
});
