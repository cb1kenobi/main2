# Parser

The parser is a multi-pass, hierarchical argument parser. It resolves commands,
subcommands, options, flags, and positional arguments from a declarative schema.

```js
import { parse } from 'main2';

const state = await parse({
	argv: process.argv.slice(2),
	env: process.env,
	schema: {
		options: {
			'-v, --verbose': 'Print more output',
			'--no-color': 'Disable colored output',
		},
		commands: {
			build: {
				options: { '--target <name>': { choices: ['esm', 'cjs'] } },
				args: ['<entry>', '[rest...]'],
				run({ argv }) {
					// argv.target, argv.entry, argv.rest, argv.verbose, argv.color
				},
			},
		},
	},
});
```

## How resolution works

Two rules govern lookup, and they are deliberately different from each other:

- **Commands resolve against the innermost context only.** Once `build` is
  matched, a later `build` token is looked up in `build`'s own subcommands, not
  the root's. A token that repeats a command name becomes a positional
  argument.
- **Options resolve across the whole context chain.** A subcommand can use any
  option its parents declare, so `build --verbose` works when `--verbose` is
  declared at the root.

The parser makes repeated passes, one per discovered context, because an option
may appear before the command that declares it. `--target esm build` resolves:
the first pass finds `build`, the second pass resolves `--target` against it.

## Commands

Commands are declared as an object keyed by name, or as a path to a file,
directory, or npm package that exports one (see [Lazy loading](#lazy-loading)).

The name string carries more than a name:

| Syntax      | Meaning                                       |
| ----------- | --------------------------------------------- |
| `build`     | Command named `build`                         |
| `@b`        | Alias — resolves to the command, not its name |
| `!internal` | Hidden alias, omitted from help               |
| `<arg>`     | Inline required argument                      |
| `[arg]`     | Inline optional argument                      |

Labels are separated by commas or spaces, so `'build, @b <entry>'` declares a
command named `build`, aliased `b`, taking one required argument.

> [!WARNING]
> A bare comma list such as `'build, b'` does **not** create an alias. Each
> unprefixed label overwrites the name in turn, so the command ends up named
> `b` and `build` is never registered. Use `@b`. This is a known bug.

Aliases can also be given as a property, which is clearer for more than one:

```js
const schema = {
	commands: {
		build: { alias: ['b', 'compile'] },
	},
};
```

Inline arguments cannot be combined with an `args` array on the same command;
declaring both throws.

### Command properties

| Property   | Type                     | Notes                                               |
| ---------- | ------------------------ | --------------------------------------------------- |
| `alias`    | `string \| string[]`     | Additional names                                    |
| `args`     | `(string \| Argument)[]` | Positional arguments                                |
| `commands` | `object \| string`       | Subcommands, or a path to load them from            |
| `desc`     | `string`                 | Description for help                                |
| `hidden`   | `boolean`                | Omit from help — **see bug note below**             |
| `hooks`    | `{ init, parse }`        | Lifecycle callbacks                                 |
| `options`  | `object`                 | Options scoped to this command and its children     |
| `run`      | `(state) => unknown`     | Handler invoked by `main2()` when this command wins |

> [!WARNING]
> An explicit `hidden: true` is currently overwritten by name parsing, so it
> only takes effect via the `!` name prefix. Known bug.

### Lazy loading

`commands` may be a path instead of an object. The parser resolves, in order:

1. A **package** — a directory with a `package.json`, loaded via its `exports`
   or `main`, falling back to `index.js` / `index.mjs` / `index.cjs`. The
   package's `name` and `description` fill in the command's `name` and `desc`.
2. A **directory** — every `.js`, `.mjs`, and `.cjs` file inside becomes a
   command named after the file.
3. A **file** — one command, named after the file unless a name is given.

The module must default-export a command object. Loading is deferred until the
command is actually matched, so a large CLI only pays for the branch it takes.

## Arguments

Positional arguments are declared as strings or objects:

| Syntax     | Required | Multiple |
| ---------- | -------- | -------- |
| `foo`      | no       | no       |
| `<foo>`    | yes      | no       |
| `[foo]`    | no       | no       |
| `foo...`   | no       | yes      |
| `<foo...>` | yes      | yes      |
| `[foo...]` | no       | yes      |
| `[foo]...` | no       | yes      |

A variadic argument collects every remaining positional value into an array.
An optional argument that precedes a required one is promoted to required,
since there is no way to skip it.

### Argument properties

| Property    | Type                    | Notes                                    |
| ----------- | ----------------------- | ---------------------------------------- |
| `choices`   | `unknown[]`             | Allowed values; validated when present   |
| `default`   | `unknown`               | Used when the argument is absent         |
| `env`       | `string \| string[]`    | Environment fallback; first defined wins |
| `multiple`  | `boolean`               | Collect into an array                    |
| `name`      | `string`                | Required                                 |
| `required`  | `boolean`               |                                          |
| `transform` | `(value, state) => any` | Runs before type coercion                |
| `type`      | `DataType`              | Defaults to `string`                     |

## Options

Options are declared as an object whose **key is a format string**. The value
may be `null`, a description string, or an object of properties.

```js
const schema = {
	options: {
		'-v, --verbose': null, // flag
		'-o, --output <dir>': 'Where to write', // takes a value
		'--cache [dir]': {}, // optional value
		'--no-color': null, // negated flag
		'--tag <name>': { multiple: true }, // repeatable
	},
};
```

The format string is split on commas, spaces, pipes, and equals signs. Each
part is interpreted by shape:

| Part     | Meaning                                        |
| -------- | ---------------------------------------------- |
| `--name` | Long name; the first one becomes the base name |
| `-n`     | Short name                                     |
| `<hint>` | Takes a value, and the **option is required**  |
| `[hint]` | Takes a value                                  |

An option with no hint and no `choices` is a **flag**.

> [!IMPORTANT]
> `<hint>` marks the _option_ as required, not just its value. This diverges
> from Commander and yargs, where `<>` means the value is mandatory when the
> option appears and the option's own requiredness is separate. Use `[hint]`
> for an optional option that takes a value. This is intentional and tested —
> see `test/parser/options.test.ts`.

The destination key on `state.argv` is the base name in camelCase, so
`--dry-run` becomes `argv.dryRun`.

### How an option gets its value

An option that takes a value looks in three places, in order:

1. An attached value — `--name=chris` or `--name"chris"`.
2. The next token, if it is allowed to be a value.
3. Nothing at all.

Step 2 is the interesting one:

> [!IMPORTANT]
> An option consumes the next token **unless that token resolves to an option
> that something in the context chain declared.** So `--name --verbose` leaves
> `--verbose` alone, while `--name --undeclared` takes `--undeclared` as the
> value.

This diverges from Commander, which reports `option argument missing` for any
value starting with a dash. Values legitimately start with a dash — `--num -15`,
`--filter -test` — and refusing all of them makes those spellings unreachable.
What a schema does know for certain is its own options, so those, and only
those, are protected. `--name=--verbose` forces the issue either way.

Protected tokens are declared long and short options anywhere in the context
chain, a short group that resolves against it (`-ab` where both are declared),
and the `--` terminator. A **command** name is not protected: when `--name
build` is read, `build` has not been matched yet, so `--name` takes it. Use an
attached value if that matters.

> [!WARNING]
> Protection only covers options that are already known when the token is read.
> A subcommand's option used _before_ its subcommand is not yet declared, so an
> earlier option takes it: given `--target` on `build`, `--name --target x
build` reads as `name: '--target'` and leaves `x` stranded. Putting the
> subcommand first works. This falls out of the multi-pass design — options are
> bound as they are read, which is also what lets `--name build` treat a
> command name as a plain value.

An option that reaches step 3 gets an empty string, which its data type then
coerces — `''` for `string`, `0` for `number`. A **required** option that
reaches step 3, or that is handed an explicitly empty value, throws instead:

| Input                 | `--name <v>` (required) | `--name [v]` (optional) |
| --------------------- | ----------------------- | ----------------------- |
| `--name chris`        | `'chris'`               | `'chris'`               |
| `--name=chris`        | `'chris'`               | `'chris'`               |
| `--name`              | throws                  | `''`                    |
| `--name=`             | throws                  | `''`                    |
| `--name --declared`   | throws                  | `''`                    |
| `--name --undeclared` | `'--undeclared'`        | `'--undeclared'`        |

### Undeclared options

An option-like token that nothing declared still produces a value, so a CLI can
pass options through without declaring them. Set
`settings.allowUnknownOptions` to `false` to throw `Unknown option "--foo"`
instead.

| Input         | Result                   |
| ------------- | ------------------------ |
| `--foo`       | `foo: true`              |
| `--foo=bar`   | `foo: 'bar'`             |
| `--foo bar`   | `foo: 'bar'`             |
| `--foo --bar` | `foo: true`, `bar: true` |
| `-x 1`        | `x: 1`                   |

They are resolved only after every command has been matched, so nothing is
called undeclared until every context that could have declared it is known.
They then differ from declared options in three ways, all of them because
nothing said what they are:

- They take the next token only when it is **not** option-like, since nothing
  declared that they take a value at all. A declared option is the mirror
  image: it is known to want a value, so it takes whatever follows.
- Values are coerced with `auto`, since there is no declared type to coerce to.
  `--age 20` is the number `20`, not `'20'`.
- `no-` is not read as negation. `--no-color` is `noColor: true`, not
  `color: false`.

Only the `--long-name` and `-x` forms are recognized. An unresolved short group
such as `-abc` stays a positional value. Repeating an undeclared option
overwrites the previous value; it does not collect into an array. Undeclared
options are not pushed onto `state._`.

### Negation

A name beginning with `no-` becomes a negated flag. Both spellings are
registered, and the one actually typed decides the value:

| Input              | Result  |
| ------------------ | ------- |
| _(absent)_         | `true`  |
| `--color`          | `true`  |
| `--no-color`       | `false` |
| `--color=false`    | `false` |
| `--no-color=false` | `true`  |

### Short option groups

Groups are expanded against the schema, not by shape, because whether a
character is a flag or the start of a value depends on how it was declared:

| Input       | Given                        | Result           |
| ----------- | ---------------------------- | ---------------- |
| `-abc`      | all flags                    | `-a -b -c`       |
| `-n5`       | `-n` takes a value           | `-n 5`           |
| `-abcvalue` | `-a`, `-b` flags, `-c` value | `-a -b -c value` |
| `-ab val`   | `-a` flag, `-b` value        | `-a -b val`      |

A group that cannot be resolved in the current context is left alone and
retried once more contexts are known.

### Option properties

| Property    | Type                    | Notes                                        |
| ----------- | ----------------------- | -------------------------------------------- |
| `alias`     | `string \| string[]`    | Extra short or long names                    |
| `choices`   | `unknown[]`             | Allowed values; implies the option takes one |
| `default`   | `unknown`               | Used when absent                             |
| `desc`      | `string`                | Description for help                         |
| `env`       | `string \| string[]`    | Environment fallback; first defined wins     |
| `hidden`    | `boolean`               | Omit from help                               |
| `hint`      | `string`                | Value placeholder                            |
| `multiple`  | `boolean`               | Repeatable; collects into an array           |
| `negate`    | `boolean`               | Force or suppress negation                   |
| `required`  | `boolean`               | Option must be present                       |
| `transform` | `(value, state) => any` | Runs before type coercion                    |
| `type`      | `OptionDataType`        | Defaults to `bool` for flags, else `string`  |

## Data types

| Type     | Accepts                                      | Produces  |
| -------- | -------------------------------------------- | --------- |
| `string` | anything                                     | `string`  |
| `bool`   | anything; `'false'` and `''` are false       | `boolean` |
| `yesno`  | `y`, `yes`, `n`, `no` (case-insensitive)     | `boolean` |
| `int`    | `-?\d+` or `0x…`                             | `number`  |
| `number` | anything `Number()` accepts                  | `number`  |
| `date`   | `YYYY-MM-DD`, ISO 8601, or 13-digit epoch ms | `Date`    |
| `json`   | valid JSON                                   | `unknown` |
| `count`  | flags only; counts occurrences               | `number`  |
| `auto`   | guesses bool, then date, then number, JSON   | varies    |

`string` is the default. `auto` is opt-in because its guesses are lossy —
it turns `007` into `7` — and because it makes static types unusable.

Flags accept only `bool`, `count`, `yesno`, and `auto`; the last two are
normalized to `bool`. `count` is rejected on non-flags.

> [!NOTE]
> `bool` treats any non-empty string other than `'false'` as true, so
> `--flag=0` is `true`.

## Value precedence

For each option and argument, the first defined source wins:

1. A value parsed from `argv`
2. `env`
3. `default`

String values from `argv`, `env`, and string `default`s are all coerced to the
declared type. Non-string defaults are passed through untouched, so
`default: 8080` stays a number regardless of `type`. A `multiple` option whose
value comes from a default or the environment is wrapped in an array.

A user `transform` runs before type coercion, and only on values parsed from
`argv` — not on defaults or environment fallbacks.

## Terminator and leftovers

`--` ends parsing. Everything after it is collected verbatim as _extra_
arguments and requires `settings.allowExtraArguments`, or parsing throws.

Positional values with no matching argument definition throw unless
`settings.allowUnexpectedArguments` is set. All positional values, matched or
not, are also pushed onto `state._`. Option-like tokens are never positional
values — see [Undeclared options](#undeclared-options).

## Settings

| Setting                    | Default | Effect                                                        |
| -------------------------- | ------- | ------------------------------------------------------------- |
| `allowExtraArguments`      | `false` | Permit arguments after `--`                                   |
| `allowUnexpectedArguments` | `false` | Permit undeclared positional arguments                        |
| `allowUnknownOptions`      | `true`  | Collect undeclared options instead of throwing                |
| `assertCwd`                | `true`  | Fail early if the working directory is gone                   |
| `errorHandler`             | —       | `false` to rethrow, or a function to render errors yourself   |
| `helpExitCode`             | —       | Exit code after printing help _(help is not implemented yet)_ |

## Errors

`parse()` throws. `main2()` catches — from the working directory check, from
`parse()`, and from the matched command's `run()`, synchronously or as a
rejected promise — and hands the thrown value to `errorHandler()`, the single
place an error becomes output:

```
$ mycli build
Error: Missing required options: --target
$ echo $?
1
```

The message and nothing else. Parser errors are plain `Error`s whose messages
are written for the person running the CLI, so a stack trace would only bury
them. The whole error is logged through the debug logger, so
`DEBUG=main2:error` brings the stack back when you want it.

`errorHandler()` sets `process.exitCode` rather than calling `process.exit()`,
so buffered stdout still flushes. The code is `1`, unless the thrown value
carries an `exitCode` that is an integer from 0 to 255 — an explicit `0`
included, which is how a future `--help` short-circuit will exit cleanly.
Anything that is not an `Error` renders too: a thrown string, an object with a
`message`, even `null`.

After an error is handled, `main2()` resolves with `undefined`. It does not
reject: its caller is a bin script, and an unhandled rejection printing a
stack is exactly what the handler exists to avoid.

### Handling errors yourself

| `settings.errorHandler` | Effect                                                 |
| ----------------------- | ------------------------------------------------------ |
| unset                   | Built-in handler renders and sets `process.exitCode`   |
| `false`                 | `main2()` rethrows; nothing is written, no code is set |
| a function              | Replaces the handler; it owns output and the exit code |

A custom handler that throws rejects `main2()`. That is a bug in the handler,
and swallowing it would leave nothing at all reporting the original error.

```js
await main2({
	schema,
	settings: {
		errorHandler(err, { state }) {
			console.error(`${state?.cmd?.name ?? 'cli'}: ${err.message}`);
			process.exitCode = 2;
		},
	},
});
```

### Rendering more than the message

`errorHandler(err, opts)` takes a `render` function — this is the seam the
Phase 3 help and ANSI work plugs into, once there is a usage line to print and
color to print it in:

```js
import { errorHandler, renderError } from 'main2/error-handler';

errorHandler(err, {
	render: (err, { state }) => `${renderError(err)}\n\n${usageFor(state?.cmd)}`,
});
```

The renderer is handed the `ParseState` on `ctx` whenever there is one, which
is where the matched command — and therefore the usage line — comes from. That
includes a parse error: the errors that most want a usage line are exactly the
ones that stop `parse()` from returning, so `parse()` stashes its in-flight
state on the error it throws, under the exported `ErrorState` symbol and
non-enumerably, and `main2()` reads it back. Only an error thrown before there
is a state at all — invalid parse options, an invalid schema — arrives without
one. A renderer that throws falls back to the default one,
so a broken renderer cannot swallow the error it was given. `opts.stderr`
redirects the output, which is mostly there for tests. A `write` that throws
is swallowed — rendering an error must not raise a second, worse one — but an
asynchronous `EPIPE` still arrives as an `error` event on the stream, and
handling that belongs to the terminal wrapper that Phase 3 brings back.

> [!NOTE]
> The `beforeError` hook is not wired up yet. When it is, it fires inside
> `main2()`'s catch, before the handler and before the `false` opt-out, so a
> hook can annotate or replace the error on its way out.

## Differences from Commander and yargs

Much of this parser's test suite is a port of Commander's and yargs-parser's,
so the places they disagree are known and deliberate. If you are coming from
Commander, these are the ones that will bite:

| Behavior                        | Commander                        | Here                                     |
| ------------------------------- | -------------------------------- | ---------------------------------------- |
| `<value>` in an option format   | value required when option used  | **option itself** is required            |
| Unspecified flag                | `undefined`                      | `false` (`true` when negated)            |
| `--opt` with no value           | `true`                           | `''`, coerced by the data type           |
| `--opt` when option required    | error                            | error                                    |
| Bare positional name `foo`      | required                         | optional                                 |
| Value that looks like an option | error                            | taken, unless it is a declared option    |
| Negative numbers                | number-shaped check              | just a value nobody declared             |
| Undeclared option               | error                            | collected onto `argv`                    |
| String `default`                | used as-is                       | coerced to the declared type             |
| Option format strictness        | one short, one long              | extras become aliases; bare word allowed |
| Repeatable option               | `<v...>` eats consecutive values | `multiple` collects repeated uses        |
| `-p=value`                      | value is `=value`                | value is `value`                         |
| `-0`                            | negative zero                    | undeclared short option `0`              |

Coming from yargs-parser, the difference that matters most is that this parser
is schema-driven and yargs-parser is not — it infers everything from argv:

| Behavior               | yargs-parser              | Here                              |
| ---------------------- | ------------------------- | --------------------------------- |
| Short group `-cats`    | always expanded           | expanded only against a schema    |
| `--no-moo`             | `moo: false`              | `noMoo: true` unless declared     |
| `--n1 -33`             | `n1: -33`                 | `n1: true`, `-33` left positional |
| Destinations           | every spelling and alias  | one camelCase destination         |
| `state._`              | values are type-guessed   | raw strings                       |
| `--foo` with a default | falls back to the default | `''`, coerced by the data type    |
| Repeated `--multi`     | collects into an array    | last wins, unless `multiple`      |

The reasoning for each is in the deliberate-decisions list in `AGENTS.md`.

## Hooks

Schema-level hooks are arrays of functions on `schema.hooks`:

| Hook          | When                                                 |
| ------------- | ---------------------------------------------------- |
| `beforeParse` | Before argv is walked                                |
| `afterParse`  | After argv is walked                                 |
| `beforeError` | **Declared but never fired — see [Errors](#errors)** |

Command-level hooks live on `command.hooks`:

| Hook    | When                                       |
| ------- | ------------------------------------------ |
| `init`  | When the command is initialized            |
| `parse` | When the command is matched during parsing |

## Parse state

`parse()` resolves to a `ParseState`:

| Field      | Description                                     |
| ---------- | ----------------------------------------------- |
| `argv`     | Resolved values, keyed by camelCase destination |
| `_`        | Every positional value, in order                |
| `$`        | The classified token stream — see below         |
| `$orig`    | The original argv                               |
| `cmd`      | The innermost matched command, if any           |
| `contexts` | The context chain, innermost first              |
| `env`      | The environment used for fallbacks              |
| `schema`   | The schema, after initialization                |
| `settings` | The settings in effect                          |

Each entry in `$` is classified as one of `Command`, `Option`, `UnknownOption`,
`Extra`, or `Unknown`, the last being a positional value.

> [!WARNING]
> `parse()` currently mutates the schema object it is given — it writes
> `name`, `args`, and `hidden` in place. Do not reuse a schema object across
> calls where that matters.
