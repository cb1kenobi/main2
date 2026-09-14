/**
 * Every option shape in one place: flags, values, types, defaults, the
 * environment, choices, repeats, and negation.
 *
 *   node demos/parser/02-options.js --target cjs -vv --define A=1 --define B=2
 *   node demos/parser/02-options.js --no-color --port 3000
 *   PORT=9000 node demos/parser/02-options.js
 *   node demos/parser/02-options.js --help
 */
import { main2 } from 'main2';

await main2({
	argv: process.argv.length > 2 ? undefined : ['--target', 'cjs', '-vv', '--define', 'A=1'],
	schema: {
		name: 'options',
		desc: 'One of each kind of option',
		commands: {
			show: {
				default: true,
				options: {
					// a flag is always true or false, never undefined
					'--minify': 'Minify the output',

					// `[value]` takes an optional value; `<value>` would make the
					// option itself required
					'--target [name]': { choices: ['esm', 'cjs'], default: 'esm', desc: 'Output format' },

					// a data type coerces argv, the environment, and a string default
					'--port [n]': { default: 8080, desc: 'Port to serve on', env: 'PORT', type: 'int' },

					// repeats collect into an array
					'--define [pair]': { desc: 'Define a global', multiple: true },

					// a counter counts its uses, and `-v=3` sets it outright
					'-v, --verbose': { desc: 'Say more, repeatable', type: 'count' },

					// two options, one destination: `color` is true or false
					'--color': { default: true, desc: 'Colorize output' },
					'--no-color': 'Turn color off',
				},
				run({ argv }) {
					console.log(argv);
				},
			},
		},
	},
});
