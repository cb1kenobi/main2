import { CSI, ESC, sgr } from '../ansi/codes.js';

/**
 * What a wrapped line has to put back.
 *
 * Wrapping styled text means breaking in the middle of it, and a style left
 * open across a break bleeds into the margin -- which for a background color is
 * visible, and for anything reading the output line by line is wrong. So each
 * line closes what it left open and the next one opens it again, and knowing
 * what to open again means knowing what was in effect at the break.
 *
 * That is not the same as replaying every sequence seen so far. `ESC[31m`
 * followed by `ESC[32m` leaves green in effect, not both, and `ESC[0m` leaves
 * nothing. Attributes replace each other within a slot, so the state is one
 * entry per slot rather than a list of sequences.
 */
export interface SgrState {
	/** Whether anything at all is in effect. */
	readonly active: boolean;
	/** Reads the sequence that turns off everything in effect. */
	close(): string;
	/** Reads the sequence that puts back everything in effect. */
	open(): string;
	/** Applies one SGR sequence. Anything else is ignored. */
	apply(sequence: string): void;
	/** Forgets everything in effect. */
	reset(): void;
}

/**
 * The slots an SGR parameter can occupy. One entry per slot, because a
 * parameter replaces whatever held its slot before: two foreground colors in a
 * row leave the second one in effect, and remembering the first would put the
 * wrong color back.
 *
 * Named rather than numbered so that the table below reads as what it is.
 */
type Slot =
	| 'intensity'
	| 'italic'
	| 'underline'
	| 'blink'
	| 'inverse'
	| 'hidden'
	| 'strikethrough'
	| 'overline'
	| 'foreground'
	| 'background'
	| 'underlineColor';

/**
 * Which slot each SGR parameter fills, and what closes that slot.
 *
 * The parameters that only close a slot -- 22 through 29, 39, 49, 55, 59 -- are
 * absent on purpose: applying one clears its slot rather than filling it, which
 * is what `closes` below says.
 */
const slots: Record<number, Slot> = {
	1: 'intensity',
	2: 'intensity',
	3: 'italic',
	4: 'underline',
	5: 'blink',
	6: 'blink',
	7: 'inverse',
	8: 'hidden',
	9: 'strikethrough',
	21: 'underline', // doubly underlined
	53: 'overline',
	58: 'underlineColor',
	// the colors, including the 38/48 forms that carry their own parameters
	30: 'foreground',
	31: 'foreground',
	32: 'foreground',
	33: 'foreground',
	34: 'foreground',
	35: 'foreground',
	36: 'foreground',
	37: 'foreground',
	38: 'foreground',
	90: 'foreground',
	91: 'foreground',
	92: 'foreground',
	93: 'foreground',
	94: 'foreground',
	95: 'foreground',
	96: 'foreground',
	97: 'foreground',
	40: 'background',
	41: 'background',
	42: 'background',
	43: 'background',
	44: 'background',
	45: 'background',
	46: 'background',
	47: 'background',
	48: 'background',
	100: 'background',
	101: 'background',
	102: 'background',
	103: 'background',
	104: 'background',
	105: 'background',
	106: 'background',
	107: 'background',
};

/** The parameter that empties each slot, which is what closing one writes. */
const closes: Record<Slot, number> = {
	background: 49,
	blink: 25,
	foreground: 39,
	hidden: 28,
	intensity: 22,
	inverse: 27,
	italic: 23,
	overline: 55,
	strikethrough: 29,
	underline: 24,
	underlineColor: 59,
};

/** Which parameter closes which slot, for reading a sequence's parameters. */
const closedBy = new Map<number, Slot>(
	Object.entries(closes).map(([slot, code]) => [code, slot as Slot])
);

/**
 * How many parameters 38, 48, and 58 take in their semicolon form, counting
 * themselves and the mode: `38;5;n` is a palette index and takes three,
 * `38;2;r;g;b` is a color and takes five. Keyed on the mode, which is the
 * parameter right after the 38.
 *
 * A mode that is neither is a malformed sequence, and taking the rest of it is
 * the only safe reading -- guessing a shorter run would leave its tail to be
 * read as attributes of their own.
 */
const extendedLengths: Record<number, number> = { 2: 5, 5: 3 };

/**
 * Tracks what a stream of SGR sequences leaves in effect.
 *
 * @returns The state, empty.
 */
export function createSgrState(): SgrState {
	// insertion ordered, so putting styles back writes them in the order they
	// were set. Nothing depends on that order, but stable output does.
	const state = new Map<Slot, string>();

	return {
		get active() {
			return state.size > 0;
		},

		apply(sequence: string): void {
			const params = sgrParams(sequence);
			if (params === undefined) {
				return;
			}

			for (let i = 0; i < params.length; i++) {
				const code = params[i]!;

				// a reset, and the sequence that carries no parameters at all
				if (code === 0) {
					state.clear();
					continue;
				}

				const closed = closedBy.get(code);
				if (closed !== undefined) {
					state.delete(closed);
					continue;
				}

				const slot = slots[code];
				if (slot === undefined) {
					// something this does not model -- a font, a framing attribute, an
					// ideogram mark. Ignoring it loses it across a break, which is better
					// than guessing at a slot and losing something else with it.
					continue;
				}

				if (code === 38 || code === 48 || code === 58) {
					const length = extendedLengths[params[i + 1]!] ?? params.length - i;
					state.set(slot, params.slice(i, i + length).join(';'));
					i += length - 1;
					continue;
				}

				state.set(slot, String(code));
			}
		},

		close(): string {
			if (state.size === 0) {
				return '';
			}
			// one sequence rather than one per slot, and the slots that are actually
			// open rather than a blanket reset: a reset would also undo anything the
			// surrounding output had set that this text never touched
			return sgr([...state.keys()].map((slot) => closes[slot]).join(';'));
		},

		open(): string {
			return state.size === 0 ? '' : sgr([...state.values()].join(';'));
		},

		reset(): void {
			state.clear();
		},
	};
}

/**
 * The parameters of an SGR sequence, as numbers.
 *
 * A sub-parameter -- the `3` of `ESC[4:3m`, or the channels of `ESC[38:2:...m`
 * -- belongs to the parameter in front of it rather than standing on its own, so
 * only the part before the colon is read.
 *
 * @param sequence - The sequence to read.
 * @returns The parameters, or `undefined` when the sequence is not an SGR.
 */
function sgrParams(sequence: string): number[] | undefined {
	const body = sgrBody(sequence);

	if (body === undefined) {
		return undefined;
	}

	// an SGR with no parameters means the same as `0`
	return body === '' ? [0] : body.split(';').map((param) => Number.parseInt(param, 10) || 0);
}

/**
 * The parameters of an SGR sequence, unparsed, or `undefined` when the sequence
 * is something else. Cursor movement and hyperlinks pass through wrapping
 * untouched; only the attributes have to be put back.
 *
 * @param sequence - The sequence to read.
 * @returns The text between the introducer and the `m`.
 */
function sgrBody(sequence: string): string | undefined {
	const prefix = sequence.startsWith(`${ESC}[`) ? 2 : sequence.startsWith(CSI) ? 1 : 0;

	if (prefix === 0 || !sequence.endsWith('m')) {
		return undefined;
	}

	const body = sequence.slice(prefix, -1);
	return /^[\d;:]*$/.test(body) ? body : undefined;
}
