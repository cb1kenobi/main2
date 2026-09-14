import { graphemes, graphemeWidth } from '../width/index.js';
import { DEFAULT_STYLE, type Style, StyleTable } from './style.js';

/**
 * A grid of cells, addressed by row and column.
 *
 * A cell holds one grapheme cluster and a style index. A cluster two columns
 * wide -- most CJK, most emoji -- occupies its own cell and leaves a
 * **continuation** in the next one, so the grid stays addressable by column
 * even where the text is not. Without that marker there is no way to answer
 * "what is in column 40" for a screen containing a single wide character, and
 * every clip, overwrite, and diff would be off by one from there rightwards.
 *
 * Two parallel arrays rather than an array of cell objects: the diff's inner
 * loop compares a style per cell, and comparing integers out of a typed array
 * is most of what makes that loop cheap.
 */

/** What a cell holds when nothing has been painted into it. */
export const BLANK = ' ';

/** The right-hand half of a wide cluster. Never painted, never drawn. */
export const CONTINUATION = '';

export class Buffer {
	#chars: string[];
	#styles: Int32Array;
	#width: number;
	#height: number;

	constructor(width: number, height: number) {
		this.#width = Math.max(0, Math.trunc(width));
		this.#height = Math.max(0, Math.trunc(height));
		const size = this.#width * this.#height;
		this.#chars = new Array<string>(size).fill(BLANK);
		this.#styles = new Int32Array(size);
	}

	get width(): number {
		return this.#width;
	}

	get height(): number {
		return this.#height;
	}

	/**
	 * Resizes, discarding what was there.
	 *
	 * Nothing is preserved on purpose. A resize means the layout is about to run
	 * again at the new size and paint everything, and keeping stale cells would
	 * only give the diff something wrong to compare against -- the frame that was
	 * on screen described a terminal that no longer exists.
	 *
	 * @param width - The new width.
	 * @param height - The new height.
	 */
	resize(width: number, height: number): void {
		const next = new Buffer(width, height);
		this.#chars = next.#chars;
		this.#styles = next.#styles;
		this.#width = next.#width;
		this.#height = next.#height;
	}

	/** Puts every cell back to a blank in the default style. */
	clear(): void {
		this.#chars.fill(BLANK);
		this.#styles.fill(StyleTable.DEFAULT);
	}

	/**
	 * Whether a coordinate is on the grid.
	 *
	 * @param x - The column.
	 * @param y - The row.
	 * @returns Whether it can be addressed.
	 */
	inside(x: number, y: number): boolean {
		return x >= 0 && y >= 0 && x < this.#width && y < this.#height;
	}

	/** The index of a cell, or `-1` when it is off the grid. */
	#at(x: number, y: number): number {
		return this.inside(x, y) ? y * this.#width + x : -1;
	}

	/**
	 * The grapheme in a cell. An empty string means the cell is the right-hand
	 * half of a wide cluster.
	 *
	 * @param x - The column.
	 * @param y - The row.
	 * @returns The grapheme, or a blank when off the grid.
	 */
	charAt(x: number, y: number): string {
		const index = this.#at(x, y);
		return index < 0 ? BLANK : this.#chars[index];
	}

	/**
	 * The style index of a cell.
	 *
	 * @param x - The column.
	 * @param y - The row.
	 * @returns The index, or the default style when off the grid.
	 */
	styleAt(x: number, y: number): number {
		const index = this.#at(x, y);
		return index < 0 ? StyleTable.DEFAULT : this.#styles[index];
	}

	/** @internal Raw access, for the diff, which walks by index. */
	rawChars(): readonly string[] {
		return this.#chars;
	}

	/** @internal */
	rawStyles(): Int32Array {
		return this.#styles;
	}

	/**
	 * Blanks a cell, and repairs whatever wide cluster it was part of.
	 *
	 * Overwriting half of a wide cluster has to take the other half with it. Left
	 * alone, the surviving half is a lead cell whose continuation now holds
	 * something else, or a continuation with no lead -- either way the terminal
	 * is told to draw half a glyph, and every column after it on that row is
	 * shifted.
	 *
	 * @param x - The column.
	 * @param y - The row.
	 * @param styleIndex - The style to leave the blanked cells in.
	 */
	#breakCluster(x: number, y: number, styleIndex: number): void {
		const index = this.#at(x, y);
		if (index < 0) {
			return;
		}

		if (this.#chars[index] === CONTINUATION) {
			// this is the right-hand half; the lead is the cell before it
			const lead = this.#at(x - 1, y);
			if (lead >= 0) {
				this.#chars[lead] = BLANK;
				this.#styles[lead] = styleIndex;
			}
			return;
		}

		if (graphemeWidth(this.#chars[index]) === 2) {
			// this is the lead; its continuation follows
			const tail = this.#at(x + 1, y);
			if (tail >= 0) {
				this.#chars[tail] = BLANK;
				this.#styles[tail] = styleIndex;
			}
		}
	}

	/**
	 * Paints one grapheme cluster.
	 *
	 * A zero-width cluster -- a lone combining mark, a variation selector -- is
	 * refused rather than given a cell of its own. It has no column to occupy,
	 * and `graphemes()` has already attached it to the cluster it modifies.
	 *
	 * @param x - The column.
	 * @param y - The row.
	 * @param cluster - One grapheme cluster.
	 * @param styleIndex - The interned style.
	 * @returns How many columns were consumed, which is `0` when nothing was
	 * painted.
	 */
	put(x: number, y: number, cluster: string, styleIndex: number): number {
		const width = graphemeWidth(cluster);
		if (width === 0) {
			return 0;
		}

		const index = this.#at(x, y);
		if (index < 0) {
			// off the left or right edge, or off the grid entirely. A wide cluster
			// whose lead is on-grid but whose continuation is not is refused below
			return 0;
		}

		if (width === 2 && x + 1 >= this.#width) {
			// no room for the second half. Half a wide glyph is worse than none, so
			// a blank takes the column and the caller's clipping decides the rest
			this.#breakCluster(x, y, styleIndex);
			this.#chars[index] = BLANK;
			this.#styles[index] = styleIndex;
			return 1;
		}

		this.#breakCluster(x, y, styleIndex);
		if (width === 2) {
			this.#breakCluster(x + 1, y, styleIndex);
		}

		this.#chars[index] = cluster;
		this.#styles[index] = styleIndex;

		if (width === 2) {
			this.#chars[index + 1] = CONTINUATION;
			this.#styles[index + 1] = styleIndex;
		}

		return width;
	}

	/**
	 * Paints a string, cluster by cluster, stopping at the right edge.
	 *
	 * @param x - The starting column.
	 * @param y - The row.
	 * @param text - The text. Split into clusters, so combining marks and emoji
	 * sequences stay whole.
	 * @param styleIndex - The interned style.
	 * @returns How many columns were consumed.
	 */
	write(x: number, y: number, text: string, styleIndex: number): number {
		let column = x;
		for (const cluster of graphemes(text)) {
			if (column >= this.#width) {
				break;
			}
			const consumed = this.put(column, y, cluster, styleIndex);
			if (consumed === 0 && graphemeWidth(cluster) > 0) {
				// off the grid rather than zero-width: nothing further will land
				break;
			}
			column += consumed;
		}
		return column - x;
	}

	/**
	 * Fills a rectangle with a grapheme, clipped to the grid.
	 *
	 * @param x - The left column.
	 * @param y - The top row.
	 * @param width - How many columns.
	 * @param height - How many rows.
	 * @param cluster - What to fill with. One column wide.
	 * @param styleIndex - The interned style.
	 */
	fill(
		x: number,
		y: number,
		width: number,
		height: number,
		cluster: string,
		styleIndex: number
	): void {
		for (let row = y; row < y + height; row++) {
			for (let column = x; column < x + width; column++) {
				this.put(column, row, cluster, styleIndex);
			}
		}
	}

	/**
	 * Copies another buffer's contents over this one, which is how a presented
	 * frame becomes the thing the next frame is compared against.
	 *
	 * @param other - The buffer to copy from. Must be the same size.
	 */
	copyFrom(other: Buffer): void {
		if (other.#width !== this.#width || other.#height !== this.#height) {
			this.#width = other.#width;
			this.#height = other.#height;
			this.#chars = new Array<string>(other.#chars.length);
			this.#styles = new Int32Array(other.#styles.length);
		}
		for (let i = 0; i < this.#chars.length; i++) {
			this.#chars[i] = other.#chars[i];
		}
		this.#styles.set(other.#styles);
	}

	/**
	 * The grid as lines of plain text, with no styling.
	 *
	 * For tests, and for anything that wants to know what a frame says rather
	 * than how it looks. A continuation contributes nothing, so a wide cluster
	 * appears once and the line reads the way it renders.
	 *
	 * @returns One string per row.
	 */
	toLines(): string[] {
		const lines: string[] = [];
		for (let y = 0; y < this.#height; y++) {
			let line = '';
			for (let x = 0; x < this.#width; x++) {
				line += this.#chars[y * this.#width + x];
			}
			lines.push(line);
		}
		return lines;
	}

	/**
	 * The grid as one string, rows joined by newlines and trailing blanks
	 * trimmed -- which is what a snapshot wants to read.
	 *
	 * @returns The text.
	 */
	toString(): string {
		return this.toLines()
			.map((line) => line.replace(/ +$/, ''))
			.join('\n');
	}
}

/**
 * A painter over a buffer that takes styles as objects and interns them.
 *
 * The buffer deals in style indices because that is what makes it fast; a
 * caller deals in styles because that is what makes it writable. This is the
 * one place that converts.
 */
export class Painter {
	#buffer: Buffer;
	#styles: StyleTable;

	constructor(buffer: Buffer, styles: StyleTable) {
		this.#buffer = buffer;
		this.#styles = styles;
	}

	/**
	 * Paints text.
	 *
	 * @param x - The starting column.
	 * @param y - The row.
	 * @param text - What to paint.
	 * @param style - How it looks. The terminal's own, if omitted.
	 * @returns How many columns were consumed.
	 */
	text(x: number, y: number, text: string, style: Style = DEFAULT_STYLE): number {
		return this.#buffer.write(x, y, text, this.#styles.intern(style));
	}

	/**
	 * Fills a rectangle.
	 *
	 * @param x - The left column.
	 * @param y - The top row.
	 * @param width - How many columns.
	 * @param height - How many rows.
	 * @param style - How it looks.
	 * @param cluster - What to fill with. A blank, if omitted.
	 */
	fill(
		x: number,
		y: number,
		width: number,
		height: number,
		style: Style = DEFAULT_STYLE,
		cluster: string = BLANK
	): void {
		this.#buffer.fill(x, y, width, height, cluster, this.#styles.intern(style));
	}
}
