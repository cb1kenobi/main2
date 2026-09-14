import type { Style } from '../style/index.js';
import {
	type Box,
	borderWidth,
	clamp,
	distribute,
	type LayoutNode,
	type LayoutResult,
	type Measurement,
	resolve,
} from './node.js';

/**
 * A flexbox subset over whole cells.
 *
 * Ours rather than borrowed: ink uses Yoga, which is a native/WASM dependency,
 * and zero dependencies rules that out. That is the price of the constraint and
 * this file is most of it.
 *
 * The integer part is the hard part, not the easy part. Distributing seven
 * leftover columns across three children means somebody gets three and somebody
 * gets two, and the rule for who has to be stable -- a layout that reshuffles
 * its rounding between frames shimmers -- which is why every division goes
 * through `distribute()` rather than being rounded where it is written.
 */

/** Which way round the axes are for a given direction. */
interface Axis {
	/** Whether the main axis runs down the screen rather than across it. */
	column: boolean;
	/** Whether items are placed from the far end back. */
	reverse: boolean;
}

function axisOf(style: Style): Axis {
	return {
		column: style.flexDirection === 'column' || style.flexDirection === 'column-reverse',
		reverse: style.flexDirection === 'row-reverse' || style.flexDirection === 'column-reverse',
	};
}

/** The space padding and border take on the main and cross axes. */
function insets(style: Style, axis: Axis) {
	const border = borderWidth(style);
	const horizontal = style.paddingLeft + style.paddingRight + border * 2;
	const vertical = style.paddingTop + style.paddingBottom + border * 2;
	return {
		border,
		cross: axis.column ? horizontal : vertical,
		main: axis.column ? vertical : horizontal,
	};
}

/**
 * The border-box size a declared length asks for.
 *
 * `box-sizing: border-box` -- the default here, because in a terminal
 * `width: 20` meaning twenty columns on screen is what everybody means -- takes
 * the declaration as the outer size. `content-box`, which is CSS's default,
 * takes it as the space inside, so the padding and border are added on.
 *
 * @param style - The node's style.
 * @param declared - The resolved declaration, if there is one.
 * @param inset - The padding and border on that axis, both edges.
 * @returns The border-box size, or `undefined` when nothing was declared.
 */
function outerSize(style: Style, declared: number | undefined, inset: number): number | undefined {
	if (declared === undefined) {
		return undefined;
	}
	return style.boxSizing === 'content-box' ? declared + inset : declared;
}

/** A margin resolved to cells. `auto` is zero for sizing and absorbs space later. */
function margins(style: Style, available: number | undefined) {
	const value = (length: typeof style.marginTop) => resolve(length, available) ?? 0;
	return {
		auto: {
			bottom: style.marginBottom.type === 'auto',
			left: style.marginLeft.type === 'auto',
			right: style.marginRight.type === 'auto',
			top: style.marginTop.type === 'auto',
		},
		bottom: value(style.marginBottom),
		left: value(style.marginLeft),
		right: value(style.marginRight),
		top: value(style.marginTop),
	};
}

/** An item during layout: everything resolved, nothing placed yet. */
interface Item {
	basis: number;
	/** Where this child sits in the tree, which is not where it is placed. */
	index: number;
	crossSize: number;
	frozen: boolean;
	mainSize: number;
	margin: ReturnType<typeof margins>;
	maxCross: number | undefined;
	maxMain: number | undefined;
	minCross: number | undefined;
	minMain: number | undefined;
	node: LayoutNode;
	style: Style;
}

export interface LayoutOptions {
	/** The height available. `undefined` lets the tree be as tall as it needs. */
	height?: number;
	/** The width available. */
	width: number;
}

/**
 * Lays out a tree.
 *
 * @param root - The node to lay out.
 * @param opts - The space available.
 * @returns The laid-out tree.
 */
export function layout(root: LayoutNode, opts: LayoutOptions): LayoutResult {
	const result = layoutNode(root, opts.width, opts.height, 0, 0);
	return result;
}

/**
 * Measures a node's content without placing anything: what it would ask for if
 * it could have whatever it wanted.
 *
 * @param node - The node to measure.
 * @param availableWidth - The width to measure against, for wrapping.
 * @returns The intrinsic size.
 */
export function measureNode(node: LayoutNode, availableWidth: number): Measurement {
	const { style } = node;

	if (style.display === 'none') {
		return { height: 0, minWidth: 0, width: 0 };
	}

	const axis = axisOf(style);
	const inset = insets(style, axis);
	const horizontal = axis.column ? inset.cross : inset.main;
	const vertical = axis.column ? inset.main : inset.cross;

	const declaredWidth = outerSize(style, resolve(style.width, availableWidth), horizontal);
	const inner = Math.max(0, (declaredWidth ?? availableWidth) - horizontal);

	if (node.measure) {
		const measured = node.measure(inner);
		return {
			height: measured.height + vertical,
			minWidth: (measured.minWidth ?? measured.width) + horizontal,
			width: measured.width + horizontal,
		};
	}

	const children = (node.children ?? []).filter((c) => c.style.display !== 'none');
	if (children.length === 0) {
		return {
			height: (resolve(style.height, undefined) ?? 0) + vertical,
			minWidth: horizontal,
			width: (declaredWidth ?? 0) + horizontal,
		};
	}

	const gapMain = axis.column ? style.rowGap : style.columnGap;
	let mainTotal = 0;
	let crossMax = 0;
	let minMainTotal = 0;
	let minCrossMax = 0;

	for (const child of children) {
		const childMargin = margins(child.style, inner);
		const measured = measureNode(child, inner);
		const extraH = childMargin.left + childMargin.right;
		const extraV = childMargin.top + childMargin.bottom;

		const mainSize = axis.column ? measured.height + extraV : measured.width + extraH;
		const minMain = axis.column ? measured.height + extraV : (measured.minWidth ?? 0) + extraH;
		const crossSize = axis.column ? measured.width + extraH : measured.height + extraV;
		const minCross = axis.column ? (measured.minWidth ?? 0) + extraH : measured.height + extraV;

		mainTotal += mainSize;
		minMainTotal += minMain;
		crossMax = Math.max(crossMax, crossSize);
		minCrossMax = Math.max(minCrossMax, minCross);
	}

	const gaps = gapMain * Math.max(0, children.length - 1);
	mainTotal += gaps;
	minMainTotal += gaps;

	const width = axis.column ? crossMax + inset.cross : mainTotal + inset.main;
	const height = axis.column ? mainTotal + inset.main : crossMax + inset.cross;
	const minWidth = axis.column ? minCrossMax + inset.cross : minMainTotal + inset.main;

	return {
		height: resolve(style.height, undefined) ?? height,
		minWidth: declaredWidth === undefined ? minWidth : declaredWidth + horizontal,
		width: declaredWidth === undefined ? width : declaredWidth + horizontal,
	};
}

/**
 * Lays a node out at a known position and size.
 *
 * @param node - The node.
 * @param availableWidth - The width its parent gave it.
 * @param availableHeight - The height its parent gave it, if it knows one.
 * @param x - Where the border box starts.
 * @param y - Where the border box starts.
 * @returns The laid-out subtree.
 */
function layoutNode(
	node: LayoutNode,
	availableWidth: number,
	availableHeight: number | undefined,
	x: number,
	y: number
): LayoutResult {
	const { style } = node;

	if (style.display === 'none') {
		const empty: Box = { height: 0, width: 0, x, y };
		return { box: empty, children: [], content: { ...empty }, node };
	}

	const axis = axisOf(style);
	const inset = insets(style, axis);
	const horizontal = axis.column ? inset.cross : inset.main;
	const vertical = axis.column ? inset.main : inset.cross;

	const width = clamp(
		availableWidth,
		outerSize(style, resolve(style.minWidth, availableWidth), horizontal),
		outerSize(style, resolve(style.maxWidth, availableWidth), horizontal)
	);

	const innerWidth = Math.max(0, width - horizontal);

	// a node with no height given takes what its content needs
	const minH = outerSize(style, resolve(style.minHeight, availableHeight), vertical);
	const maxH = outerSize(style, resolve(style.maxHeight, availableHeight), vertical);
	const height = clamp(availableHeight ?? measureNode(node, availableWidth).height, minH, maxH);

	const innerHeight = Math.max(0, height - vertical);

	const box: Box = { height, width, x, y };
	const content: Box = {
		height: innerHeight,
		width: innerWidth,
		x: x + inset.border + style.paddingLeft,
		y: y + inset.border + style.paddingTop,
	};

	const children = (node.children ?? []).filter((c) => c.style.display !== 'none');
	if (children.length === 0) {
		return { box, children: [], content, node };
	}

	const placed = layoutChildren(node, children, content, axis);
	return { box, children: placed, content, node };
}

/**
 * Places a node's children inside its content box.
 *
 * @param parent - The containing node.
 * @param children - Its visible children.
 * @param content - The area to place them in.
 * @param axis - Which way the main axis runs.
 * @returns The laid-out children.
 */
function layoutChildren(
	parent: LayoutNode,
	children: LayoutNode[],
	content: Box,
	axis: Axis
): LayoutResult[] {
	const { style } = parent;
	const mainSpace = axis.column ? content.height : content.width;
	const crossSpace = axis.column ? content.width : content.height;
	const gap = axis.column ? style.rowGap : style.columnGap;

	// `order` changes where a child is *placed*, not where it lives. The results
	// stay in tree order so `result.children[i]` still answers for
	// `node.children[i]`; only the placement walk is sorted, and stably, so equal
	// orders keep their source sequence
	const items = children.map((child, index) => makeItem(child, axis, content, index));
	const ordered = [...items].sort((a, b) => a.style.order - b.style.order);
	const lines = style.flexWrap === 'nowrap' ? [ordered] : wrapIntoLines(ordered, mainSpace, gap);

	const results: LayoutResult[] = [];
	const lineCrossSizes: number[] = [];

	for (const line of lines) {
		resolveFlexible(line, mainSpace, gap, axis);
		lineCrossSizes.push(Math.max(0, ...line.map((item) => outerCross(item, axis))));
	}

	const crossGap = axis.column ? style.columnGap : style.rowGap;
	const crossGaps = crossGap * Math.max(0, lines.length - 1);

	if (style.flexWrap === 'wrap-reverse') {
		lines.reverse();
		lineCrossSizes.reverse();
	}

	// a single line takes the whole cross space; several share it out according
	// to `align-content`
	if (lines.length === 1) {
		lineCrossSizes[0] = crossSpace;
	}

	const free = Math.max(0, crossSpace - lineCrossSizes.reduce((a, b) => a + b, 0) - crossGaps);
	let crossCursor = 0;
	let betweenLines = crossGap;

	if (lines.length > 1) {
		switch (style.alignContent) {
			case 'flex-end':
				crossCursor = free;
				break;
			case 'center':
				crossCursor = Math.floor(free / 2);
				break;
			case 'space-between':
				betweenLines = crossGap + Math.floor(free / (lines.length - 1));
				break;
			case 'space-around':
				betweenLines = crossGap + Math.floor(free / lines.length);
				crossCursor = Math.floor(free / lines.length / 2);
				break;
			case 'stretch': {
				// the leftover is shared out rather than handed to the last line, so
				// the lines together fill the cross space exactly
				const shares = distribute(
					free,
					lineCrossSizes.map(() => 1)
				);
				for (const [index, share] of shares.entries()) {
					lineCrossSizes[index] += share;
				}
				break;
			}
			default:
				break;
		}
	}

	for (const [index, line] of lines.entries()) {
		const lineCross = lineCrossSizes[index];
		placeLine(line, {
			axis,
			content,
			crossOffset: crossCursor,
			crossSize: lineCross,
			gap,
			mainSpace,
			results,
			style,
		});
		crossCursor += lineCross + betweenLines;
	}

	// tree order, not placement order
	results.sort((a, b) => children.indexOf(a.node) - children.indexOf(b.node));
	return results;
}

/** The main-axis size an item occupies including its margins. */
function outerMain(item: Item, axis: Axis): number {
	const { margin } = item;
	return item.mainSize + (axis.column ? margin.top + margin.bottom : margin.left + margin.right);
}

/** The cross-axis size an item occupies including its margins. */
function outerCross(item: Item, axis: Axis): number {
	const { margin } = item;
	return item.crossSize + (axis.column ? margin.left + margin.right : margin.top + margin.bottom);
}

/** Resolves a child's sizes before any flexing. */
function makeItem(node: LayoutNode, axis: Axis, content: Box, index: number): Item {
	const style = node.style;
	const margin = margins(style, axis.column ? content.height : content.width);
	const measured = measureNode(node, Math.max(0, content.width - margin.left - margin.right));

	const inset = insets(style, axis);
	const mainInset = axis.column ? inset.main : inset.cross;
	const crossInset = axis.column ? inset.cross : inset.main;

	const declaredMain = outerSize(
		style,
		axis.column ? resolve(style.height, content.height) : resolve(style.width, content.width),
		mainInset
	);
	const basisLength = style.flexBasis;
	const basisResolved =
		basisLength.type === 'auto' || basisLength.type === 'none'
			? declaredMain
			: outerSize(
					style,
					resolve(basisLength, axis.column ? content.height : content.width),
					mainInset
				);

	const contentMain = axis.column ? measured.height : measured.width;
	const basis = basisResolved ?? contentMain;

	const minMain = axis.column
		? outerSize(style, resolve(style.minHeight, content.height), mainInset)
		: (outerSize(style, resolve(style.minWidth, content.width), mainInset) ?? measured.minWidth);
	const maxMain = axis.column
		? outerSize(style, resolve(style.maxHeight, content.height), mainInset)
		: outerSize(style, resolve(style.maxWidth, content.width), mainInset);

	const declaredCross = outerSize(
		style,
		axis.column ? resolve(style.width, content.width) : resolve(style.height, content.height),
		crossInset
	);
	const contentCross = axis.column ? measured.width : measured.height;

	return {
		basis,
		crossSize: declaredCross ?? contentCross,
		frozen: false,
		index,
		mainSize: basis,
		margin,
		maxCross: axis.column
			? outerSize(style, resolve(style.maxWidth, content.width), crossInset)
			: outerSize(style, resolve(style.maxHeight, content.height), crossInset),
		maxMain,
		minCross: axis.column
			? outerSize(style, resolve(style.minWidth, content.width), crossInset)
			: outerSize(style, resolve(style.minHeight, content.height), crossInset),
		minMain,
		node,
		style,
	};
}

/** Breaks items into lines that fit, for `flex-wrap`. */
function wrapIntoLines(items: Item[], mainSpace: number, gap: number): Item[][] {
	const lines: Item[][] = [];
	let current: Item[] = [];
	let used = 0;

	for (const item of items) {
		const size = Math.max(item.minMain ?? 0, Math.min(item.basis, item.maxMain ?? item.basis));
		const withGap = current.length === 0 ? size : size + gap;

		if (current.length > 0 && used + withGap > mainSpace) {
			lines.push(current);
			current = [item];
			used = size;
			continue;
		}

		current.push(item);
		used += withGap;
	}

	if (current.length > 0) {
		lines.push(current);
	}

	return lines.length > 0 ? lines : [[]];
}

/**
 * The flexible-length resolution: hand out or take back the difference between
 * what the items asked for and what there is.
 *
 * CSS freezes an item when clamping stops it moving and repeats; so does this.
 * The difference is that every hand-out goes through `distribute()`, so the
 * parts are whole cells and always add up to the space there was.
 *
 * @param line - The items on one line.
 * @param mainSpace - The space they share.
 * @param gap - The gap between them.
 */
function resolveFlexible(line: Item[], mainSpace: number, gap: number, axis: Axis): void {
	if (line.length === 0) {
		return;
	}

	for (const item of line) {
		item.mainSize = item.basis;
		item.frozen = false;
	}

	const gaps = gap * (line.length - 1);
	const marginTotal = line.reduce((sum, item) => sum + outerMain(item, axis) - item.mainSize, 0);

	for (let pass = 0; pass < line.length + 1; pass++) {
		const used = line.reduce((sum, item) => sum + item.mainSize, 0) + gaps + marginTotal;
		const free = mainSpace - used;

		const movable = line.filter(
			(item) => !item.frozen && (free > 0 ? item.style.flexGrow > 0 : item.style.flexShrink > 0)
		);

		if (free === 0 || movable.length === 0) {
			break;
		}

		// shrinking is weighted by the base size, as in CSS: a big item gives up
		// more than a small one at the same shrink factor
		const weights = movable.map((item) =>
			free > 0 ? item.style.flexGrow : item.style.flexShrink * Math.max(1, item.basis)
		);
		const shares = distribute(Math.abs(free), weights);

		let clampedAny = false;
		for (const [index, item] of movable.entries()) {
			const wanted = item.mainSize + (free > 0 ? shares[index] : -shares[index]);
			const settled = clamp(wanted, item.minMain, item.maxMain);
			if (settled !== wanted) {
				clampedAny = true;
				item.frozen = true;
			}
			item.mainSize = settled;
		}

		if (!clampedAny) {
			break;
		}
	}

	for (const item of line) {
		item.mainSize = clamp(item.mainSize, item.minMain, item.maxMain);
	}
}

interface PlaceOptions {
	axis: Axis;
	content: Box;
	crossOffset: number;
	crossSize: number;
	gap: number;
	mainSpace: number;
	results: LayoutResult[];
	style: Style;
}

/** Places one line of items and recurses into each. */
function placeLine(line: Item[], opts: PlaceOptions): void {
	const { axis, content, crossOffset, crossSize, gap, mainSpace, results, style } = opts;

	if (line.length === 0) {
		return;
	}

	const used = line.reduce((sum, item) => sum + outerMain(item, axis), 0) + gap * (line.length - 1);
	const free = Math.max(0, mainSpace - used);

	const autoMains = line.filter((item) =>
		axis.column
			? item.margin.auto.top || item.margin.auto.bottom
			: item.margin.auto.left || item.margin.auto.right
	).length;

	let leading = 0;
	let between = gap;

	if (autoMains === 0) {
		switch (style.justifyContent) {
			case 'flex-end':
				leading = free;
				break;
			case 'center':
				leading = Math.floor(free / 2);
				break;
			case 'space-between':
				if (line.length > 1) {
					between = gap + Math.floor(free / (line.length - 1));
				}
				break;
			case 'space-around':
				between = gap + Math.floor(free / line.length);
				leading = Math.floor(free / line.length / 2);
				break;
			case 'space-evenly':
				between = gap + Math.floor(free / (line.length + 1));
				leading = Math.floor(free / (line.length + 1));
				break;
			default:
				break;
		}
	}

	const order = axis.reverse ? [...line].reverse() : line;
	let cursor = leading;

	for (const item of order) {
		const marginMainStart = axis.column ? item.margin.top : item.margin.left;
		const marginMainEnd = axis.column ? item.margin.bottom : item.margin.right;

		// an auto margin on the main axis eats the free space, which is how a box
		// is pushed to one end or centred without touching `justify-content`
		let autoLead = 0;
		if (autoMains > 0) {
			const autoStart = axis.column ? item.margin.auto.top : item.margin.auto.left;
			const autoEnd = axis.column ? item.margin.auto.bottom : item.margin.auto.right;
			const count = (autoStart ? 1 : 0) + (autoEnd ? 1 : 0);
			if (count > 0) {
				const share = Math.floor(free / autoMains);
				autoLead = autoStart ? (autoEnd ? Math.floor(share / 2) : share) : 0;
			}
		}

		const mainStart = cursor + marginMainStart + autoLead;

		const align = item.style.alignSelf === 'auto' ? style.alignItems : item.style.alignSelf;
		const marginCrossStart = axis.column ? item.margin.left : item.margin.top;
		const marginCrossEnd = axis.column ? item.margin.right : item.margin.bottom;
		const roomCross = Math.max(0, crossSize - marginCrossStart - marginCrossEnd);

		let itemCross = item.crossSize;
		if (align === 'stretch' && !crossIsDeclared(item, axis)) {
			itemCross = roomCross;
		}
		itemCross = clamp(itemCross, item.minCross, item.maxCross);

		let crossStart = crossOffset + marginCrossStart;
		if (align === 'flex-end') {
			crossStart += roomCross - itemCross;
		} else if (align === 'center') {
			crossStart += Math.floor((roomCross - itemCross) / 2);
		}

		const childX = axis.column ? content.x + crossStart : content.x + mainStart;
		const childY = axis.column ? content.y + mainStart : content.y + crossStart;
		const childWidth = axis.column ? itemCross : item.mainSize;
		const childHeight = axis.column ? item.mainSize : itemCross;

		results.push(layoutNode(item.node, childWidth, childHeight, childX, childY));

		cursor = mainStart + item.mainSize + marginMainEnd + between;
	}
}

/** Whether an item's cross size was asked for rather than derived. */
function crossIsDeclared(item: Item, axis: Axis): boolean {
	const length = axis.column ? item.style.width : item.style.height;
	return length.type !== 'auto' && length.type !== 'none';
}
