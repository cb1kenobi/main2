import { type LayoutNode, type LayoutResult, layout } from '../../src/layout/index.js';
import { declare, type Declarations, type Style } from '../../src/style/index.js';
import { stringWidth } from '../../src/width/index.js';
import { wrap } from '../../src/wrap/index.js';

/**
 * Layout is the one layer in the stack that needs no terminal, no renderer, and
 * no reactivity to test -- so it is tested by laying a tree out and reading the
 * result back as a picture. A failing assertion that prints two grids says what
 * went wrong; one that prints `{ x: 3, y: 0, width: 11, height: 2 }` does not,
 * and this engine has enough arithmetic in it that the difference matters.
 */

/** Builds a node from declarations, so a test reads like a stylesheet. */
export function box(declarations: Declarations, ...children: LayoutNode[]): LayoutNode {
	return { children, style: declare(declarations) };
}

/**
 * A text node that measures the way the real one will: through `stringWidth()`
 * for the width and `wrap()` for the height.
 *
 * @param content - The text.
 * @param declarations - Any style it carries.
 * @returns The node.
 */
export function text(content: string, declarations: Declarations = {}): LayoutNode {
	const style: Style = declare(declarations);
	return {
		measure(availableWidth: number) {
			const longestWord = Math.max(
				0,
				...content
					.split(/\s+/)
					.filter(Boolean)
					.map((word) => stringWidth(word))
			);

			if (style.whiteSpace === 'nowrap' || availableWidth <= 0) {
				return { height: 1, minWidth: longestWord, width: stringWidth(content) };
			}

			const wrapped = wrap(content, { width: availableWidth });
			const lines = wrapped.split('\n');
			return {
				height: lines.length,
				minWidth: longestWord,
				width: Math.max(0, ...lines.map((line) => stringWidth(line))),
			};
		},
		style,
	};
}

/**
 * Renders a laid-out tree to a grid of characters.
 *
 * Each node paints its border box with a character of its own, so a picture
 * shows where every box ended up and which is which. Text nodes paint their
 * text. Later nodes paint over earlier ones, which is document order.
 *
 * @param result - The laid-out tree.
 * @param width - The grid width.
 * @param height - The grid height.
 * @param marks - The characters to use, depth-first in document order.
 * @returns The grid, one string per row.
 */
export function render(
	result: LayoutResult,
	width: number,
	height: number,
	marks = 'abcdefghijklmnopqrstuvwxyz'
): string {
	const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => '.'));
	let index = 0;

	const paint = (node: LayoutResult): void => {
		const mark = marks[index % marks.length];
		index++;

		const { box: area } = node;
		for (let y = area.y; y < area.y + area.height; y++) {
			for (let x = area.x; x < area.x + area.width; x++) {
				if (y >= 0 && y < height && x >= 0 && x < width) {
					rows[y][x] = mark;
				}
			}
		}

		for (const child of node.children) {
			paint(child);
		}
	};

	paint(result);
	return rows.map((row) => row.join('')).join('\n');
}

/**
 * Lays a tree out and renders it, which is what most of these tests want.
 *
 * @param node - The tree.
 * @param width - The space available.
 * @param height - The space available.
 * @returns The picture.
 */
export function picture(node: LayoutNode, width: number, height: number): string {
	return render(layout(node, { height, width }), width, height);
}

/** Every node's box, depth-first, for the assertions a picture cannot make. */
export function boxes(
	result: LayoutResult
): { height: number; width: number; x: number; y: number }[] {
	const out: { height: number; width: number; x: number; y: number }[] = [];
	const walk = (node: LayoutResult): void => {
		out.push({ ...node.box });
		for (const child of node.children) {
			walk(child);
		}
	};
	walk(result);
	return out;
}
