# main2

A framework for building CLI apps in Node.js, and the successor to `cli-kit`.
The heart of it is a multi-pass hierarchical argument parser built for CLIs
that lean heavily on subcommands.

**Zero production dependencies is a hard constraint.** Anything the library
needs — ANSI handling, text wrapping, dotenv, `which`, debug logging — gets
written here and bundled. Do not add a runtime dependency; if one seems
necessary, raise it rather than adding it.

## Layout

| Path                     | Contents                                             |
| ------------------------ | ---------------------------------------------------- |
| `src/parser/`            | The parser: commands, options, arguments, registries |
| `src/util/`              | Shared helpers (type coercion, camelCase, mkdir)     |
| `src/debug/`             | `DEBUG`-driven logger; replaces snooplogg            |
| `src/paths.ts`           | XDG base directories                                 |
| `src/updates/`           | npm update check, run in a spawned worker            |
| `src/terminal.ts`        | Terminal wrapper — currently EPIPE handling only     |
| `docs/parser.md`         | Parser reference: syntax, semantics, precedence      |
| `test/parser/commander/` | Ported Commander test cases                          |
| `test/parser/yargs/`     | Ported yargs-parser test cases                       |

`src/ansi/`, `src/canvas/`, `src/components/`, and `src/i18n/` are empty
placeholders. Canvas and components are post-1.0.

## Commands

```
pnpm test          # vitest
pnpm check         # type-check + lint + format check
pnpm build         # tsdown -> dist/
pnpm fmt           # oxfmt --write
```

Run `pnpm check` before considering work finished. Formatting is oxfmt with
tabs, single quotes, and a 100-column width — run `pnpm fmt` rather than
matching it by hand.

## Scope

1.0 is the parser, a generated help screen, ANSI wrapping, and ANSI strip.
Nothing else. Titanium CLI is the acceptance test: if it does not need a
feature, that feature is not in 1.0.

## Deliberate decisions — do not "fix" these

These look like bugs and are not. Each is intentional and covered by tests.

- **`<value>` in an option format makes the option itself required**, not just
  its value. This diverges from Commander and yargs. Use `[value]` for an
  optional option that takes a value. Asserted in
  `test/parser/options.test.ts`.
- **The default data type is `string`, not `auto`.** `auto` guesses lossily —
  it turns `007` into `7` — and makes static types unusable. It is still
  available per option.
- **Commands resolve against the innermost context; options resolve across the
  whole context chain.** These are deliberately different. Making them the
  same breaks either parent options after a subcommand, or arguments that
  repeat a command name. Both directions are covered in
  `test/parser/regressions.test.ts`.
- **An option consumes the next token unless that token resolves to a declared
  option.** `--name --verbose` leaves `--verbose` alone; `--name --undeclared`
  takes `--undeclared` as the value. Commander errors on any dash-leading
  value, but values legitimately start with a dash and a schema only knows its
  own options. See `test/parser/option-values.test.ts` and `docs/parser.md`.
- **An option takes one value per use; only arguments are variadic.**
  `multiple` collects repeated uses (`--tag a --tag b`) into an array. An
  option never eats consecutive values, so `--tag a b` leaves `b` positional;
  `<files...>` on an _argument_ is how a list of loose values is collected. A
  `...` hint on an option is therefore rejected by `initOption` rather than
  accepted as decoration. Both Commander and yargs diverge here.
- **A required option rejects a missing or empty value; an optional one gets
  an empty string.** `--name` and `--name=` throw for `<value>` and yield `''`
  (or `0`, per the data type) for `[value]`.
- **Flags default to `false`, or `true` when negated — never `undefined`.**
  Commander leaves an unspecified flag undefined. A declared flag here always
  has a value, so `argv.verbose` is safe to read without a guard.
- **A bare positional name is optional; `<name>` is required.** Commander
  treats a bare name as required. Brackets are the only thing that decides it
  here, which keeps `args` readable at a glance.
- **String `default`s and environment values are coerced to the declared
  type.** So `default: 'black'` on a flag is `true`, not `'black'`. Non-string
  defaults pass through untouched.
- **The option format string is loose on purpose.** Extra short or long names
  become aliases rather than errors, and a bare word declares `--word`.
  Commander rejects all of those. Genuinely malformed parts — `-ws`,
  `---triple` — still throw.
- **Undeclared options produce values rather than erroring.** `--foo` is
  `foo: true`, `--foo bar` is `foo: 'bar'`. They resolve after every command
  has been matched, coerce with `auto`, do not read `no-` as negation, and do
  not reach `state._`. `settings.allowUnknownOptions: false` restores the
  `Unknown option` error.

## Known bugs

- `'build, b'` as a command name silently renames the command to `b` instead
  of aliasing it. Only `@`-prefixed labels become aliases.
- An explicit `hidden: true` on a command is overwritten by name parsing.
- `beforeError` hooks are declared and validated but never fired.
- `command.default: true` is never dispatched.
- `parse()` mutates the schema object it is given.
- A subcommand's option used before its subcommand is not protected from being
  consumed as an earlier option's value, because it is not declared yet on the
  pass that reads it. See the warning in `docs/parser.md`.
- An option and its negated twin declared separately (`'--cheese <type>'` plus
  `'--no-cheese'`) both resolve to the name `cheese`, so the registry keeps
  only whichever was added last and silently discards the other. Covered by a
  skipped test in `test/parser/commander/option-formats.test.ts`.
- A variadic argument that is not last silently swallows every remaining value,
  leaving the arguments declared after it unreachable. Commander rejects the
  schema. Covered by a skipped test in
  `test/parser/commander/arguments.test.ts`.

## Conventions

- ESM only. Imports use `.js` extensions even for `.ts` sources.
- Internal state hangs off the exported `Internal` symbol, not enumerable
  properties, so schema objects stay clean for consumers.
- Parser errors are thrown as plain `Error`s with user-facing messages; they
  are what the user sees, so write them accordingly.
- Prefer a regression test named after the defect over a comment explaining it.
