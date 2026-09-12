# main2

A framework for building CLI apps in Node.js, and the successor to `cli-kit`.
The heart of it is a multi-pass hierarchical argument parser built for CLIs
that lean heavily on subcommands.

**Zero production dependencies is a hard constraint.** Anything the library
needs — ANSI handling, text wrapping, dotenv, `which`, debug logging — gets
written here and bundled. Do not add a runtime dependency; if one seems
necessary, raise it rather than adding it.

## Layout

| Path              | Contents                                             |
| ----------------- | ---------------------------------------------------- |
| `src/parser/`     | The parser: commands, options, arguments, registries |
| `src/util/`       | Shared helpers (type coercion, camelCase, mkdir)     |
| `src/debug/`      | `DEBUG`-driven logger; replaces snooplogg            |
| `src/paths.ts`    | XDG base directories                                 |
| `src/updates/`    | npm update check, run in a spawned worker            |
| `src/terminal.ts` | Terminal wrapper — currently EPIPE handling only     |
| `docs/parser.md`  | Parser reference: syntax, semantics, precedence      |

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

## Known bugs

- `'build, b'` as a command name silently renames the command to `b` instead
  of aliasing it. Only `@`-prefixed labels become aliases.
- An explicit `hidden: true` on a command is overwritten by name parsing.
- `beforeError` hooks are declared and validated but never fired.
- `command.default: true` is never dispatched.
- `parse()` mutates the schema object it is given.

## Conventions

- ESM only. Imports use `.js` extensions even for `.ts` sources.
- Internal state hangs off the exported `Internal` symbol, not enumerable
  properties, so schema objects stay clean for consumers.
- Parser errors are thrown as plain `Error`s with user-facing messages; they
  are what the user sees, so write them accordingly.
- Prefer a regression test named after the defect over a comment explaining it.
