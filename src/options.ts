import { type OptionDeclarations } from './types.js';

/**
 * Declares a reusable set of options, keeping the literal types of what it was
 * given.
 *
 * At runtime this hands back exactly what it was handed. It exists for the types,
 * and for one thing a bare object literal loses: `const g = { '--port <n>': {
 * type: 'int' } }` widens `type` to `string`, and once it is `string` nothing can
 * tell that `--port` produces a number. A `const` type parameter keeps it `'int'`,
 * so a group stays worth inferring from wherever it ends up.
 *
 * A group is a value, so it goes wherever options go -- on the schema, on a
 * command, or spread into a command's own list:
 *
 * ```js
 * const global = options({
 *   '-v, --verbose': 'Say more',
 *   '--port <n>': { type: 'int', default: 8080 },
 * });
 *
 * await main2({
 *   schema: {
 *     options: global,
 *     commands: {
 *       build: { options: { '-w, --watch': 'Rebuild on change' } },
 *     },
 *   },
 * });
 * ```
 *
 * Nothing has to say that `build` sees `--verbose` and `--port`: options resolve
 * across the whole context chain, so declaring the group once, above, is what puts
 * it in reach of every command below.
 *
 * @param decl - The options, keyed by format string.
 * @returns The same object.
 */
export function options<const T extends OptionDeclarations>(decl: T): T {
	return decl;
}
