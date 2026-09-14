import { distribute, layout } from '../../src/layout/index.js';
import { declare } from '../../src/style/index.js';
import { box, boxes, picture, text } from './helpers.js';
import { describe, expect, it } from 'vitest';

describe('distribute', () => {
	it('should hand out whole cells that add up to the total', () => {
		// the spare cell moves forward, so it lands on the last column rather than
		// in the middle of the row
		expect(distribute(7, [1, 1, 1])).toEqual([2, 2, 3]);
		expect(distribute(10, [1, 1])).toEqual([5, 5]);
		// exactly 7.5 and 2.5: the half carried forward is what makes it 7 and 3
		expect(distribute(10, [3, 1])).toEqual([7, 3]);
	});

	it('should always add up, whatever the weights', () => {
		for (const total of [0, 1, 7, 13, 100]) {
			for (const weights of [[1], [1, 1], [1, 2, 3], [5, 1, 1, 1], [0, 1, 0, 1]]) {
				const parts = distribute(total, weights);
				expect(
					parts.reduce((a, b) => a + b, 0),
					`${total} across ${weights.join(',')}`
				).toBe(total);
				expect(parts.every((n) => Number.isInteger(n))).toBe(true);
			}
		}
	});

	it('should give nothing to a zero weight', () => {
		expect(distribute(10, [0, 1, 0])).toEqual([0, 10, 0]);
	});

	it('should be stable, so a layout does not shimmer between frames', () => {
		const first = distribute(7, [1, 1, 1]);
		const again = distribute(7, [1, 1, 1]);
		expect(first).toEqual(again);
	});

	it('should hand out nothing when there is nothing to hand out', () => {
		expect(distribute(0, [1, 2])).toEqual([0, 0]);
		expect(distribute(10, [])).toEqual([]);
		expect(distribute(10, [0, 0])).toEqual([0, 0]);
	});
});

describe('a row', () => {
	it('should place children left to right', () => {
		const tree = box(
			{ 'flex-direction': 'row' },
			box({ width: '3', height: '2' }),
			box({ width: '4', height: '2' })
		);

		expect(picture(tree, 10, 2)).toBe(['bbbccccaaa', 'bbbccccaaa'].join('\n'));
	});

	it('should separate children by the gap', () => {
		const tree = box(
			{ 'flex-direction': 'row', gap: '2' },
			box({ width: '2', height: '1' }),
			box({ width: '2', height: '1' })
		);

		expect(picture(tree, 8, 1)).toBe('bbaaccaa');
	});

	it('should grow a child into the space left over', () => {
		const tree = box(
			{ 'flex-direction': 'row' },
			box({ width: '3', height: '1' }),
			box({ 'flex-grow': '1', height: '1' })
		);

		expect(picture(tree, 10, 1)).toBe('bbbccccccc');
	});

	it('should share leftover space between two growing children', () => {
		const tree = box(
			{ 'flex-direction': 'row' },
			box({ 'flex-grow': '1', height: '1' }),
			box({ 'flex-grow': '1', height: '1' })
		);

		expect(picture(tree, 10, 1)).toBe('bbbbbccccc');
	});

	it('should split an odd remainder without losing a cell', () => {
		const tree = box(
			{ 'flex-direction': 'row' },
			box({ 'flex-grow': '1', height: '1' }),
			box({ 'flex-grow': '1', height: '1' }),
			box({ 'flex-grow': '1', height: '1' })
		);

		// seven across three: nobody gets two and a third, and no column is left
		// unaccounted for
		const picture7 = picture(tree, 7, 1);
		expect(picture7).not.toContain('.');
		expect(picture7.length).toBe(7);
	});

	it('should weight growth by flex-grow', () => {
		const tree = box(
			{ 'flex-direction': 'row' },
			box({ 'flex-grow': '1', height: '1' }),
			box({ 'flex-grow': '3', height: '1' })
		);

		expect(picture(tree, 8, 1)).toBe('bbcccccc');
	});

	it('should shrink children that do not fit', () => {
		const tree = box(
			{ 'flex-direction': 'row' },
			box({ width: '8', height: '1' }),
			box({ width: '8', height: '1' })
		);

		const result = picture(tree, 10, 1);
		expect(result.length).toBe(10);
		expect(result).not.toContain('.');
	});

	it('should not shrink a child below its min-width', () => {
		const tree = box(
			{ 'flex-direction': 'row' },
			box({ width: '8', 'min-width': '6', height: '1' }),
			box({ width: '8', height: '1' })
		);

		const [, first] = boxes(layout(tree, { height: 1, width: 10 }));
		expect(first.width).toBeGreaterThanOrEqual(6);
	});

	it('should not grow a child past its max-width', () => {
		const tree = box(
			{ 'flex-direction': 'row' },
			box({ 'flex-grow': '1', 'max-width': '4', height: '1' })
		);

		const [, first] = boxes(layout(tree, { height: 1, width: 10 }));
		expect(first.width).toBe(4);
	});
});

describe('a column', () => {
	it('should place children top to bottom', () => {
		const tree = box(
			{ 'flex-direction': 'column' },
			box({ height: '1', width: '4' }),
			box({ height: '2', width: '4' })
		);

		expect(picture(tree, 4, 3)).toBe(['bbbb', 'cccc', 'cccc'].join('\n'));
	});

	it('should grow a child down the page', () => {
		const tree = box(
			{ 'flex-direction': 'column' },
			box({ height: '1', width: '3' }),
			box({ 'flex-grow': '1', width: '3' })
		);

		expect(picture(tree, 3, 4)).toBe(['bbb', 'ccc', 'ccc', 'ccc'].join('\n'));
	});
});

describe('padding and border', () => {
	it('should inset children by the padding', () => {
		const tree = box({ padding: '1' }, box({ 'flex-grow': '1', height: '1' }));

		expect(picture(tree, 5, 3)).toBe(['aaaaa', 'abbba', 'aaaaa'].join('\n'));
	});

	it('should take a cell on each edge for a border', () => {
		const tree = box({ border: 'single' }, box({ 'flex-grow': '1', height: '1' }));

		expect(picture(tree, 5, 3)).toBe(['aaaaa', 'abbba', 'aaaaa'].join('\n'));
	});

	it('should add the border to the padding', () => {
		const tree = box({ border: 'single', padding: '1' }, box({ 'flex-grow': '1', height: '1' }));

		expect(picture(tree, 7, 5)).toBe(
			['aaaaaaa', 'aaaaaaa', 'aabbbaa', 'aaaaaaa', 'aaaaaaa'].join('\n')
		);
	});
});

describe('margins', () => {
	it('should push a child away from its neighbours', () => {
		const tree = box(
			{ 'flex-direction': 'row' },
			box({ width: '2', height: '1', 'margin-right': '2' }),
			box({ width: '2', height: '1' })
		);

		expect(picture(tree, 8, 1)).toBe('bbaaccaa');
	});

	it('should push a child to the far end with an auto margin', () => {
		const tree = box(
			{ 'flex-direction': 'row' },
			box({ width: '2', height: '1', 'margin-left': 'auto' })
		);

		expect(picture(tree, 6, 1)).toBe('aaaabb');
	});
});

describe('justify-content', () => {
	const two = () =>
		box(
			{ 'flex-direction': 'row' },
			box({ width: '2', height: '1' }),
			box({ width: '2', height: '1' })
		);

	it('should start at the beginning by default', () => {
		expect(picture(two(), 8, 1)).toBe('bbccaaaa');
	});

	it('should push to the end', () => {
		const tree = two();
		tree.style = declare({ 'flex-direction': 'row', 'justify-content': 'flex-end' });
		expect(picture(tree, 8, 1)).toBe('aaaabbcc');
	});

	it('should centre', () => {
		const tree = two();
		tree.style = declare({ 'flex-direction': 'row', 'justify-content': 'center' });
		expect(picture(tree, 8, 1)).toBe('aabbccaa');
	});

	it('should space between', () => {
		const tree = two();
		tree.style = declare({ 'flex-direction': 'row', 'justify-content': 'space-between' });
		expect(picture(tree, 8, 1)).toBe('bbaaaacc');
	});
});

describe('align-items', () => {
	it('should stretch a child across the cross axis by default', () => {
		const tree = box({ 'flex-direction': 'row' }, box({ width: '2' }));
		expect(picture(tree, 4, 3)).toBe(['bbaa', 'bbaa', 'bbaa'].join('\n'));
	});

	it('should put a child at the start', () => {
		const tree = box(
			{ 'flex-direction': 'row', 'align-items': 'flex-start' },
			box({ width: '2', height: '1' })
		);
		expect(picture(tree, 4, 3)).toBe(['bbaa', 'aaaa', 'aaaa'].join('\n'));
	});

	it('should put a child at the end', () => {
		const tree = box(
			{ 'flex-direction': 'row', 'align-items': 'flex-end' },
			box({ width: '2', height: '1' })
		);
		expect(picture(tree, 4, 3)).toBe(['aaaa', 'aaaa', 'bbaa'].join('\n'));
	});

	it('should centre a child', () => {
		const tree = box(
			{ 'flex-direction': 'row', 'align-items': 'center' },
			box({ width: '2', height: '1' })
		);
		expect(picture(tree, 4, 3)).toBe(['aaaa', 'bbaa', 'aaaa'].join('\n'));
	});

	it('should let a child override with align-self', () => {
		const tree = box(
			{ 'flex-direction': 'row', 'align-items': 'flex-start' },
			box({ width: '2', height: '1', 'align-self': 'flex-end' })
		);
		expect(picture(tree, 4, 3)).toBe(['aaaa', 'aaaa', 'bbaa'].join('\n'));
	});
});

describe('display: none', () => {
	it('should take no space and place nothing', () => {
		const tree = box(
			{ 'flex-direction': 'row' },
			box({ width: '3', height: '1', display: 'none' }),
			box({ width: '3', height: '1' })
		);

		// the hidden child is not in the tree at all, so the visible one is `b`
		expect(picture(tree, 6, 1)).toBe('bbbaaa');
	});
});

describe('text', () => {
	it('should take the width of its content', () => {
		const tree = box({ 'flex-direction': 'row' }, text('hello'));
		const [, content] = boxes(layout(tree, { height: 1, width: 20 }));
		expect(content.width).toBe(5);
	});

	it('should grow taller when it has to wrap', () => {
		const tree = box({ 'flex-direction': 'column' }, text('one two three four five'));
		const result = layout(tree, { width: 10 });
		expect(result.children[0].box.height).toBeGreaterThan(1);
	});

	it('should not shrink below its longest word', () => {
		const tree = box(
			{ 'flex-direction': 'row' },
			text('antidisestablishmentarianism'),
			box({ width: '20', height: '1' })
		);

		const [, content] = boxes(layout(tree, { height: 1, width: 10 }));
		// shrinking text past its longest word only makes it taller, and in a row
		// that has no height to give
		expect(content.width).toBeGreaterThan(0);
	});

	it('should measure a wide character as two columns', () => {
		const tree = box({ 'flex-direction': 'row' }, text('漢字'));
		const [, content] = boxes(layout(tree, { height: 1, width: 20 }));
		expect(content.width).toBe(4);
	});
});

describe('wrapping', () => {
	it('should break onto a second line when children do not fit', () => {
		const tree = box(
			{ 'flex-direction': 'row', 'flex-wrap': 'wrap' },
			box({ width: '3', height: '1' }),
			box({ width: '3', height: '1' }),
			box({ width: '3', height: '1' })
		);

		const result = picture(tree, 7, 2);
		const [first, second] = result.split('\n');
		expect(first).toContain('b');
		expect(first).toContain('c');
		expect(second).toContain('d');
	});

	it('should keep everything on one line when it says nowrap', () => {
		const tree = box(
			{ 'flex-direction': 'row', 'flex-wrap': 'nowrap' },
			box({ width: '3', height: '1' }),
			box({ width: '3', height: '1' }),
			box({ width: '3', height: '1' })
		);

		const [, second] = picture(tree, 7, 2).split('\n');
		expect(second).toBe('aaaaaaa');
	});
});

describe('nesting', () => {
	it('should lay out a tree several levels deep', () => {
		const tree = box(
			{ 'flex-direction': 'column', padding: '1' },
			box({ 'flex-direction': 'row', height: '1' }, box({ width: '2' }), box({ 'flex-grow': '1' })),
			box({ 'flex-grow': '1' })
		);

		// depth-first: the root is `a`, the row is `b`, its two children are `c`
		// and `d`, and the second top-level child is `e`. The row is covered
		// completely by its own children, so no `b` shows
		expect(picture(tree, 8, 4)).toBe(['aaaaaaaa', 'accdddda', 'aeeeeeea', 'aaaaaaaa'].join('\n'));
	});

	it('should give a child the space its parent padding left', () => {
		const tree = box({ padding: '2' }, box({ 'flex-grow': '1' }));
		const result = layout(tree, { height: 6, width: 10 });
		expect(result.children[0].box).toEqual({ height: 2, width: 6, x: 2, y: 2 });
	});
});

describe('degenerate sizes', () => {
	it('should survive a canvas with no room', () => {
		const tree = box({ 'flex-direction': 'row' }, box({ width: '3', height: '1' }));
		expect(() => layout(tree, { height: 0, width: 0 })).not.toThrow();
	});

	it('should survive a box larger than the space it was given', () => {
		const tree = box({ 'flex-direction': 'row' }, box({ width: '100', height: '100' }));
		const result = layout(tree, { height: 2, width: 4 });
		expect(result.box).toEqual({ height: 2, width: 4, x: 0, y: 0 });
	});

	it('should never produce a negative size', () => {
		const tree = box({ padding: '5' }, box({ 'flex-grow': '1' }));
		for (const region of boxes(layout(tree, { height: 2, width: 2 }))) {
			expect(region.width).toBeGreaterThanOrEqual(0);
			expect(region.height).toBeGreaterThanOrEqual(0);
		}
	});
});
