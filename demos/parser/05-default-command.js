/**
 * A default command, which is how a single-command CLI is written: the name is
 * implied, so argv goes straight to its arguments.
 *
 *   node demos/parser/05-default-command.js src/index.js --minify
 *   node demos/parser/05-default-command.js clean
 *   node demos/parser/05-default-command.js
 */
import { main2 } from 'main2';

await main2({
	argv: process.argv.length > 2 ? undefined : ['src/index.js', '--minify'],
	schema: {
		name: 'bundle',
		commands: {
			build: {
				default: true,
				desc: 'Build the project (the default)',
				args: ['<entry>'],
				options: { '--minify': 'Minify the output' },
				run: ({ argv }) => console.log('building', argv.entry, argv.minify ? '(minified)' : ''),
			},

			// a named command still wins when argv names it
			clean: { desc: 'Delete the output', run: () => console.log('cleaning') },
		},
	},
});
