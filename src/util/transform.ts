import type { DataType } from '../types.js';

const boolFalseRE = /^(false|f|no|n|off|0)$/i;
const boolTrueRE = /^(true|t|yes|y|on|1)$/i;
const dateRE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/i;
const dateIntRE = /^\d{13}$/;
const dateInvalid = /^Invalid Date$/i;
const hexRE = /^0x[A-Fa-f0-9]+$/;
const intRE = /^-?\d+$/;
const noRE = /^no?$/i;
const yesRE = /^y(es)?$/i;

export function transformValue(
	value: string,
	type: DataType | string
): Date | number | boolean | string | unknown {
	if (type === 'bool') {
		// an omitted value is false, the same way `--num` with no value is 0
		if (!value) {
			return false;
		}
		if (boolTrueRE.test(value)) {
			return true;
		}
		if (boolFalseRE.test(value)) {
			return false;
		}
		throw new Error(`Invalid boolean: "${value}"`);
	}

	if (type === 'date') {
		let date;
		let m;

		if (dateIntRE.test(value)) {
			const num = Number(value);
			if (!isNaN(num) && num > 0) {
				date = new Date(num);
			}
		} else {
			m = value.match(dateRE);
			if (m) {
				date = new Date(m[1] ? m[0] : `${m[0]}T00:00:00`);
			}
		}

		if (!date || dateInvalid.test(date.toString())) {
			throw new Error(`Invalid date: "${value}"`);
		}

		// `dateRE` checks the shape and `Date` does the rest, and `Date` overflows
		// rather than refusing: `2024-02-30` came back as March 1st, so a day that
		// does not exist produced the wrong day instead of the error `9999-99-99`
		// already got. Reading the parts back is what catches it -- a date that
		// overflowed is not the date that was written
		if (m) {
			const [year, month, day] = m[0].split(/\D/, 3).map(Number);
			if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
				throw new Error(`Invalid date: "${value}"`);
			}
		}

		return date;
	}

	// a counter is an int that argv increments rather than writes, so a value that
	// reaches it from anywhere else -- the environment, a string `default` -- is
	// coerced and rejected the same way: without this it stayed a string, and
	// `VERBOSE=lots` put the word "lots" on a destination the types call a number
	if (type === 'int' || type === 'count') {
		// a counter is a flag, and a flag with no value is off: `bool` reads an empty
		// value as false, so an empty counter is 0 rather than an error. `VERBOSE=` in
		// the environment means the variable is there and says nothing, which is the
		// one reading that is not worth failing a parse over.
		//
		// `int` reads it the same way, because the rule is the data type's and not the
		// counter's: `--port` and `--port=` on a `[value]` option are documented to
		// yield "'' or 0, per the data type", and `number` already returns 0 because
		// `Number('')` is 0. Only `int` threw, so one integer type answered an empty
		// value with 0 and the other failed the parse -- and `PORT=` in the
		// environment, which is the same "there and says nothing" reading, failed too.
		// Whitespace still throws for both, matching `bool`
		if (!value) {
			return 0;
		}

		let num;
		if ((!hexRE.test(value) && !intRE.test(value)) || isNaN((num = Number(value)))) {
			throw new Error(`Invalid ${type === 'count' ? 'count' : 'integer'}: ${value}`);
		}

		// past 2^53-1 a `number` is not the integer that was written -- `Number` maps
		// `9007199254740993` to `...992` -- so an id given to an `int` option came back
		// as a different id and nothing said so. Every other data type rejects input it
		// cannot represent, and silently returning the wrong integer is the one failure
		// a caller cannot detect
		if (!Number.isSafeInteger(num)) {
			throw new Error(
				`${type === 'count' ? 'Count' : 'Integer'} is too large to be exact: ${value}`
			);
		}

		return num;
	}

	if (type === 'json') {
		try {
			return JSON.parse(value);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} catch (e: any) {
			throw new Error(`Invalid JSON: ${e.message}`);
		}
	}

	if (type === 'number') {
		// `Number(' ')` is 0, so a value that is only whitespace parsed as zero while
		// `int`, `count`, and `bool` all threw on it. An empty value is 0 for all of
		// them, deliberately -- a space is not empty
		if (value && !value.trim()) {
			throw new Error(`Invalid number: ${value}`);
		}

		const num = Number(value);
		if (isNaN(num)) {
			throw new Error(`Invalid number: ${value}`);
		}
		return num;
	}

	if (type === 'yesno') {
		if (yesRE.test(value)) {
			return true;
		}
		if (noRE.test(value)) {
			return false;
		}
		throw new Error('Value must be "yes" or "no"');
	}

	if (type === 'auto' && typeof value === 'string') {
		// an empty or blank value is a string, not zero
		if (!value.trim()) {
			return value;
		}

		const lvalue = value.toLowerCase();

		// try as a boolean
		if (lvalue === 'true') {
			return true;
		}

		if (lvalue === 'false') {
			return false;
		}

		// try as a date
		const m = value.match(dateRE);
		if (m) {
			return new Date(m[1] ? m[0] : `${m[0]}T00:00:00`);
		}

		// try as a number
		const num = Number(value);
		if (!isNaN(num)) {
			return num;
		}

		// try as json
		try {
			return JSON.parse(value);
		} catch {
			// nope
		}
	}

	// return the original value
	return value;
}
