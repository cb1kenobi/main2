import type { DataType } from '../types.js';

const dateRE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/i;
const dateIntRE = /^\d{13}$/;
const dateInvalid = /^Invalid Date$/i;
const hexRE = /^0x[A-Fa-f0-9]+$/;
const intRE = /^-?\d+$/;
const noRE = /^no?$/i;
const yesRE = /^y(es)?$/i;

export function transformValue(value: string, type: DataType | string) {
	if (type === 'bool') {
		return !!value && value !== 'false';
	}

	if (type === 'date') {
		let date;
		let m;

		if (dateIntRE.test(value)) {
			const num = Number(value);
			if (!isNaN(num) && num > 0) {
				date = new Date(num);
			}
		} else if (m = value.match(dateRE)) {
			date = new Date(m[1] ? m[0] : `${m[0]}T00:00:00`);
		}

		if (!date || dateInvalid.test(date.toString())) {
			throw new Error(`Invalid date: "${value}"`);
		}

		return date;
	}

	if (type === 'int') {
		let num;
		if ((!hexRE.test(value) && !intRE.test(value)) || isNaN(num = Number(value))) {
			throw new Error(`Invalid integer: ${value}`);
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
