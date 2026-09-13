# main2

A framework for building CLI apps in Node.js, and the successor to `cli-kit`.

At its heart is a multi-pass hierarchical argument parser built for CLIs that
lean heavily on subcommands, with zero production dependencies.

> [!WARNING]
> Pre-1.0 and not yet published. The parser is usable and well covered by
> tests; help generation does not exist yet.

```js
import { main2 } from 'main2';

await main2({
	schema: {
		options: { '-v, --verbose': 'Print more output' },
		commands: {
			build: {
				options: { '--target <name>': { choices: ['esm', 'cjs'] } },
				args: ['<entry>', '[rest...]'],
				run({ argv }) {
					console.log(argv.target, argv.entry, argv.rest, argv.verbose);
				},
			},
		},
	},
});
```

See [docs/parser.md](docs/parser.md) for the parser reference — schema syntax,
option and argument formats, data types, value precedence, and the places this
parser deliberately differs from Commander and yargs.

## Scope for 1.0

The parser, a generated help screen, ANSI wrapping, and ANSI strip. Titanium
CLI is the acceptance test.

Still to do:

- [ ] Generated, context-sensitive help
- [ ] ANSI: styling, strip, display width
- [ ] Text wrapping and terminal width detection
- [ ] A terminal wrapper: width detection, EPIPE handling
- [ ] `beforeError` hooks
- [ ] Default command dispatch
- [ ] Fix the subpath exports
- [ ] Dotenv loading, `which` helper

After 1.0: terminal canvas, components, themes, i18n.

## License

MIT
