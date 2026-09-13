# main2

A framework for building CLI apps in Node.js.

At its heart is a multi-pass hierarchical argument parser built for CLIs that
lean heavily on subcommands, with **zero production dependencies**. ANSI
handling, text wrapping, display width, and XDG paths.

```js
import { main2 } from 'main2';

await main2({
  schema: {
    name: 'mycli',
    desc: 'A demo CLI',
    options: { '-v, --verbose': 'Print more output' },
    commands: {
      build: {
        desc: 'Build the project',
        options: { '--target [name]': { choices: ['esm', 'cjs'], default: 'esm' } },
        args: ['<entry>', '[rest...]'],
        run({ argv }) {
          console.log(argv.target, argv.entry, argv.rest, argv.verbose);
        },
      },
    },
  },
});
```

```
$ mycli build src/index.ts a b --target cjs -v
cjs src/index.ts [ 'a', 'b' ] true
```

`main2()` reads `process.argv`, matches a command, validates, and runs it. An
error becomes a message on stderr and a non-zero exit code — never a stack
trace, because the caller is a bin script.

**[docs/parser.md](docs/parser.md)** is the full parser reference: syntax,
semantics, precedence, and every place this parser deliberately differs from
Commander and yargs. This README is the API tour.

---

## Contents

- [The root entry](#the-root-entry) — `main2()`, `command()`, `options()`, errors
- [Declaring options](#declaring-options)
- [Declaring arguments](#declaring-arguments)
- [Declaring commands](#declaring-commands)
- [Settings](#settings)
- [Hooks](#hooks)
- [Help](#help)
- [Typed argv](#typed-argv)
- [Subpath modules](#subpath-modules) — `ansi`, `wrap`, `width`, `help`, `paths`, `updates`

---

## The root entry

```js
import {
  main2, // parse argv and run the matched command
  command, // identity function that types one command's argv
  options, // identity function that keeps an option group's types
  errorHandler, // the built-in error renderer + exit code
  renderError, // an error as the string that would be printed
  errorExitCode, // the exit code an error implies
} from 'main2';
```

Every type is exported from the same place — `Schema`, `Command`, `Option`,
`Argument`, `Settings`, `ParseState`, `DataType`, the hook types, and so on.

### `main2(opts)`

```ts
await main2({
  argv?: string[],      // defaults to process.argv.slice(2)
  schema?: Schema,
  settings?: Settings,
});
```

Resolves with the command's return value; with the `ParseState` when no command
ran or the command returned nothing; with `undefined` when an error was handled.

### `errorHandler`, `renderError`, `errorExitCode`

The built-in handler is what `main2()` uses unless you replace it. The pieces
are exported so you can use them from a `settings.errorHandler` of your own:

```js
import { renderError, errorExitCode } from 'main2';

await main2({
  schema,
  settings: {
    errorHandler(err) {
      console.error(`✖ ${renderError(err)}`);
      process.exitCode = errorExitCode(err);
    },
  },
});
```

`settings.errorHandler: false` rethrows instead, so you can `try`/`catch`
around `main2()`.

```js
try {
  await main2({
    argv: ['--nope'],
    schema,
    settings: { allowUnknownOptions: false, errorHandler: false },
  });
} catch (err) {
  renderError(err); // 'Error: Unknown option "--nope"'
  errorExitCode(err); // 1
}
```

> [!NOTE]
> `parse()` is internal — `main2()` is the entry point. The parse state is
> reachable from `main2()`'s return value and from every hook.

---

## Declaring options

Options are an object keyed by **format string**. The value is a description
string, or an object, or `null` for neither.

```js
options: {
  '-v, --verbose': 'Print more output',
  '--target [name]': { choices: ['esm', 'cjs'], default: 'esm', desc: 'Output format' },
  '-o, --out-dir [dir]': { default: 'dist', desc: 'Where to write' },
  '--define [pair]': { desc: 'Define a global', multiple: true },
  '--port [n]': { env: 'PORT', type: 'int' },
  '--no-color': 'Disable color',
}
```

```
$ mycli build x.ts --target cjs --define A=1 --define B=2 --no-color
{ entry: 'x.ts', target: 'cjs', define: [ 'A=1', 'B=2' ], color: false, outDir: 'dist' }
```

The format string carries the name, the aliases, and whether a value is taken:

| Format                   | Means                                                       |
| ------------------------ | ----------------------------------------------------------- |
| `--verbose`              | a flag; `argv.verbose` is `true`/`false`, never `undefined` |
| `-v, --verbose`          | the same flag, with a short alias                           |
| `--target [name]`        | takes an **optional** value                                 |
| `--target <name>`        | takes a value **and the option itself is required**         |
| `--no-color`             | a negated flag; writes `false` to `color`                   |
| `--color` + `--no-color` | one destination, two options                                |

> [!IMPORTANT]
> `<value>` makes the **option** required, not just its value — this diverges
> from Commander and yargs. Use `[value]` for an optional option that takes a
> value.

### Option properties

| Property                          | Purpose                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `type`                            | `'string'` (default), `'bool'`, `'int'`, `'number'`, `'date'`, `'json'`, `'count'`, `'yesno'`, `'auto'` |
| `default`                         | fills the destination when argv and `env` did not; strings are coerced to `type`                        |
| `env`                             | environment variable(s) to fall back to, before `default`                                               |
| `choices`                         | allowed values; also gives a flag an implied hint, making it valued                                     |
| `multiple`                        | repeated uses collect into an array                                                                     |
| `required`                        | written out, wins over what `<>`/`[]` implied                                                           |
| `transform`                       | `(value, state) => newValue`, run before type coercion, argv values only                                |
| `desc`                            | what help prints                                                                                        |
| `group`                           | puts the option under its own `<group> options:` heading in help                                        |
| `hidden`                          | keep it out of help; it still parses                                                                    |
| `negate`                          | `false` opts a `no-`-named option out of being read as negation                                         |
| `alias`, `format`, `name`, `hint` | override what the format string implied                                                                 |

Precedence for every option and argument is **argv → `env` → `default`**.

Data types, coercion rules, negation, short groups (`-abc`, `-n5`), undeclared
options, and the terminator are all covered in
[docs/parser.md](docs/parser.md#data-types).

---

## Declaring arguments

Positionals are a list of format strings or objects.

```js
args: ['<entry>', '[rest...]'];
```

| Format                    | Means                                          |
| ------------------------- | ---------------------------------------------- |
| `name`                    | optional                                       |
| `<name>`                  | **required**                                   |
| `[name]`                  | optional, explicitly                           |
| `<name...>` / `[name...]` | variadic — collects every remaining positional |

> [!NOTE]
> A bare name is **optional** here; Commander treats it as required. Brackets
> are the only thing that decides it.

The object form takes `choices`, `default`, `desc`, `env`, `multiple`, `name`,
`required`, `transform`, and `type` — the same as an option.

```js
args: [{ name: 'env', choices: ['dev', 'prod'], default: 'dev' }, '[files...]'];
```

Unmatched positionals throw unless `settings.allowUnexpectedArguments` is set.
Matched or not, every positional is also pushed onto `state._`.

---

## Declaring commands

```js
commands: {
  build: {
    desc: 'Build the project',
    options: { '--minify': 'Minify the output' },
    args: ['<entry>'],
    commands: { clean: { run() {} } },   // nested, to any depth
    run({ argv, _, cmd, contexts }) {},
  },
}
```

A command's key is its name. The first bare label is the name and the rest are
aliases, a `!` prefix hides it:

```js
commands: {
  'build, b': { run() {} },   // `build`, aliased `b`
  '!secret': { run() {} },    // works, stays out of help
}
```

### Options resolve across the whole chain

Nothing declares what a command inherits, because nothing has to. A child sees
every option its parents declared — `mycli -v build` and `mycli build -v` both
set `verbose`. Help reads the same chain and lists what is left under
`Global options`.

### The default command

Marked `default`, a command runs when argv named none — which is how a
single-command CLI is written:

```js
await main2({
  schema: {
    name: 'bundle',
    commands: {
      build: {
        default: true,
        args: ['<entry>'],
        options: { '--minify': 'Minify' },
        run: ({ argv }) => console.log(argv.entry, argv.minify),
      },
    },
  },
});
```

```
$ bundle src/index.ts --minify
src/index.ts true
```

### Lazy loading

A command can be a path to a module, a directory of them, or a package
directory. The module is not read until the command is matched.

```js
commands: {
  deploy: './commands/deploy.js',   // one module
}

commands: './commands'                // every module in a directory
```

```js
// commands/deploy.js
export default {
  desc: 'Deploy the app',
  options: { '--dry-run': 'Do not actually deploy' },
  run({ argv }) {
    console.log('dryRun =', argv.dryRun);
  },
};
```

A lazily loaded command appears in help by name alone until its module is read,
because its description lives in that module. `help <command>` does load it.

### Command properties

| Property                      | Purpose                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `run`                         | `(state) => any`; the handler                                                    |
| `desc`                        | what help prints                                                                 |
| `args`, `options`, `commands` | as above                                                                         |
| `default`                     | dispatch when argv named no command                                              |
| `alias`                       | extra names that stay out of the help label                                      |
| `hidden`                      | keep it out of help                                                              |
| `help`                        | a string that replaces the screen, or a renderer that receives the generated one |
| `hooks`                       | `init`, `parse`, `help`, `beforeError`                                           |
| `path`, `file`                | where to load the command from                                                   |
| `examples`                    | `{ label, text }` pairs for help                                                 |

---

## Settings

```js
await main2({ schema, settings: { allowExtraArguments: true } });
```

| Setting                    | Default  | Effect                                                |
| -------------------------- | -------- | ----------------------------------------------------- |
| `allowExtraArguments`      | `false`  | permit arguments after `--`                           |
| `allowUnexpectedArguments` | `false`  | permit positionals no argument declared               |
| `allowUnknownOptions`      | `true`   | undeclared options produce values instead of erroring |
| `assertCwd`                | `true`   | fail early if the working directory is gone           |
| `errorHandler`             | built-in | `false` rethrows; a function replaces it              |
| `helpExitCode`             | `0`      | the exit code after printing help                     |

---

## Hooks

```js
await main2({
  schema: {
    hooks: {
      beforeParse: [(state) => {}], // before argv is walked
      afterParse: [(state) => {}], // after, before validation results are returned
      beforeError: [(err, ctx) => {}],
    },
    commands: {
      build: {
        hooks: {
          init: [({ options, args, commands }) => {}], // when the command is built
          parse: [({ cmd, options }) => {}], // when argv matches it
          help: [({ sections, state }) => {}], // when its help is rendered
          beforeError: [(err, ctx) => {}],
        },
        run() {},
      },
    },
  },
});
```

They fire in this order:

```
init (at build time) → beforeParse → parse (as each command matches) → afterParse → run
```

A hook changes a command through the registries it is handed —
`options.add(...)`, `args.push(initArg(...))`,
`commands.add(await initCommand(...))` — which take effect immediately.

### `beforeError`

Fires for every throw site, innermost command first and the schema last, before
the error is rendered. A hook may **replace** the error but never suppress it:
return nothing to leave it alone, return a value to make that value the error.

```js
hooks: {
  beforeError: [
    (err) => (err.code === 'ENOENT' ? new Error('Run `mycli init` first') : undefined),
  ],
}
```

---

## Help

`--help` and a `help` command are added to the root automatically, and only
where your app left room: declare `-h` as `--host` and you keep it, declare
`--help` yourself and you own it entirely. `schema.help: false` adds nothing.

Help is context-sensitive — it describes the command argv actually reached:

```
$ mycli build --help
Usage: mycli build [options]

Build the project

Options:
  --target [name]  Output format (choices: esm, cjs)

Advanced options:
  --sourcemap        Emit source maps
  --tsconfig [path]  Config file

iOS options:
  --sdk [ver]         iOS SDK version
  --simulator [udid]  Simulator to run on

Global options:
  -v, --verbose  Print more output
  -h, --help     Show help for a command
```

`Advanced options` came from `group: 'Advanced'` on those two options.
`iOS options` came from a `help` hook, which is for options a command must
_describe_ without _parsing_:

```js
hooks: {
  help: [
    ({ sections }) =>
      sections.add({
        title: 'iOS',
        options: { '--sdk [ver]': 'iOS SDK version', '--simulator [udid]': 'Simulator to run on' },
      }),
  ],
}
```

> [!IMPORTANT]
> Help wins over a **missing** required option or argument — `mycli build --help`
> answers what `build` needs instead of complaining it was not given. An
> **invalid** value still throws.

Writing your own screen for one command:

```js
{
  // a string replaces the screen outright
  help: 'Usage: mycli build <entry>\n\nSee https://example.com/docs',
}

{
  // a function receives the generated screen and adds to it
  help: ({ generated }) => `${generated}\n\nDocs: https://example.com/docs`,
}
```

---

## Typed argv

`command()` and `options()` are identity functions that exist for the types.
Wrapping a command reads its format strings and gives `run` a narrow `argv`:

```ts
import { command, options } from 'main2';

const global = options({
  '-v, --verbose': 'Say more',
  '--port [n]': { default: 8080, type: 'int' },
});

const build = command({
  options: { ...global, '--target [name]': { choices: ['esm', 'cjs'] } },
  args: ['<entry>', '[rest...]'],
  run({ argv }) {
    argv.entry; // string
    argv.rest; // string[] | undefined
    argv.target; // 'esm' | 'cjs' | undefined
    argv.verbose; // boolean
    argv.port; // number
  },
});
```

Wrapping is optional and per command. A command declared as a bare object still
parses identically — it just keeps a wide `argv`.

A command is typed at its own `command()` call, and nothing there knows where in
the tree it will be mounted, so **options inherited from a parent are not in its
types** even though they resolve at runtime. Spreading the group into the
command's own options — as above — is how you get them typed, at the cost of
shadowing the parent's and moving those rows out of `Global options`.

---

## Subpath modules

Each is independently importable and has no dependencies.

### `main2/ansi`

```js
import { ansi, createAnsi, strip, hasAnsi, supportsColor } from 'main2/ansi';

ansi.bold.red('error'); // chainable, cached
ansi.hex('#ff8800')('warn');
ansi.bgRgb(0, 0, 255).white(' info ');
ansi.blue(`a ${ansi.red('b')} c`); // nesting restores the outer style

strip(ansi.bold.red('error')); // 'error'
hasAnsi('x'); // false

ansi.level; // 0-3, detected from the terminal
const forced = createAnsi({ level: 3 });
```

Color support is detected from `TERM`, `COLORTERM`, `FORCE_COLOR`, `NO_COLOR`,
CI variables, and whether the stream is a TTY. `strip()` removes SGR, OSC, DCS,
and CSI sequences, not just colors.

### `main2/wrap`

```js
import { wrap, terminalWidth, DEFAULT_WIDTH, MAX_WIDTH } from 'main2/wrap';

wrap('The quick brown fox jumps over the lazy dog and keeps on going', 24);
// The quick brown fox
// jumps over the lazy dog
// and keeps on going

wrap('one two three four five six', { width: 16, indent: '> ' });
// > one two three
// > four five six

terminalWidth(); // COLUMNS, then stream columns, then 80
terminalWidth({ env: { COLUMNS: '72' } }); // 72
```

`COLUMNS` is read first, since it is how a caller states a width the stream
cannot be asked for. The result is capped at `MAX_WIDTH` (100) — long lines are
harder to read than narrow ones — and `opts.max`, `opts.fallback`, `opts.env`,
and `opts.stream` each override a step.

Wrapping is ANSI-aware and grapheme-aware: a style open at a line break is
closed and reopened, so a background color never bleeds into the margin.

### `main2/width`

```js
import { stringWidth, graphemes, graphemeWidth, unicodeVersion } from 'main2/width';

stringWidth('日本語'); // 6  — East Asian Wide
stringWidth('á'); // 1  — combining mark
stringWidth('🇯🇵'); // 2  — regional indicator pair
stringWidth('👨‍👩‍👧‍👦'); // 2  — one ZWJ cluster
graphemes('á日🇯🇵'); // ['á', '日', '🇯🇵']
unicodeVersion; // '17.0.0'
```

### `main2/help`

```js
import { renderHelp, resolveHelp } from 'main2/help';

await resolveHelp(state); // fires the command's help hooks, then renders
renderHelp(state, { width: 100 }); // renders a context chain directly
```

`HelpOptions` takes `ansi`, `gap`, `indent`, `maxLabel`, `name`, `sections`,
and `width`.

### `main2/paths`

XDG base directories, per-platform, with `~` expanded.

```js
import { cache, config, data, state, home, tmp, configDirs, dataDirs, expand } from 'main2/paths';

cache(); // '/Users/you/Library/Caches'   (darwin)
cache('mycli'); // '/Users/you/Library/Caches/mycli'
config(); // '/Users/you/Library/Preferences'
data(); // '/Users/you/Library/Application Support'
configDirs(); // search path, XDG_CONFIG_DIRS included
expand('~/x'); // '/Users/you/x'
```

`XDG_*_HOME` and `XDG_*_DIRS` are honored everywhere. Linux and Windows get
their own tables; other platforms follow the Linux ones.

### `main2/updates`

Checks npm for a newer version in a spawned worker, so the check never blocks
the CLI.

```js
import { check } from 'main2/updates';

const { current, latest } = await check({
  packageName: 'mycli',
  packageVersion: '1.2.3',
  cacheDir: cache('mycli'),
  // wait: true,          // await the worker instead of firing and forgetting
  // checkInterval: 864e5,
  // distTag: 'latest',
});
```

By default it returns immediately with whatever the cache already had and lets
the worker refresh it for next time.

---

## License

MIT
