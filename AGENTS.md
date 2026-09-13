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
| `src/ansi/`              | SGR styling, strip, color support detection          |
| `src/width/`             | Display width: grapheme clusters, East Asian Width   |
| `src/wrap/`              | Text wrapping, SGR state, terminal width             |
| `src/help/`              | The generated help screen and its two-column layout  |
| `src/infer.ts`           | `initOption()` and `initArg()`, in the type system   |
| `src/util/`              | Shared helpers (type coercion, camelCase, mkdir)     |
| `src/debug/`             | `DEBUG`-driven logger; replaces snooplogg            |
| `src/paths.ts`           | XDG base directories                                 |
| `src/updates/`           | npm update check, run in a spawned worker            |
| `src/error-handler.ts`   | Renders an error and sets the exit code              |
| `src/error-hooks.ts`     | Fires `beforeError` hooks; carries state on an error |
| `scripts/`               | Generators, run by hand and their output committed   |
| `docs/parser.md`         | Parser reference: syntax, semantics, precedence      |
| `test/parser/commander/` | Ported Commander test cases                          |
| `test/parser/yargs/`     | Ported yargs-parser test cases                       |

`src/canvas/`, `src/components/`, and `src/i18n/` are empty placeholders. Canvas
and components are post-1.0.

`src/width/east-asian-width.ts` is generated. Regenerate it with
`node scripts/generate-east-asian-width.mjs <unicode-version>` and then
`pnpm fmt`; the version is pinned in the script so re-running reproduces what is
committed.

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

All four are in. What is left for 1.0 is static argv types, the Titanium port,
and whatever that port turns up.

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
- **A counter is never an array, and a string that reaches it is coerced.**
  `type: 'count'` already collects repeated uses, into a number rather than an array, so `multiple`
  on a counter is refused by `initOption()` the way a `...` hint is -- it asks for
  nothing a counter does not do, and the two were read by paths that disagreed:
  the counting path ignored `multiple` when the flag was used and `applyFallback()`
  wrapped the default when it was not, so `argv.v` was `2` used and `[0]` unused.
  The invariant is enforced where the value lands as well as where it is declared,
  because `multiple` stays editable after init and a hook could otherwise put it
  back. `transformValue()` coerces a counter like an `int` for the same reason: a
  value from the environment or a string `default` used to stay a string, so
  `VERBOSE=lots` put the word on a destination the types call a number; an empty
  value is `0`, matching `bool`, and whitespace throws, also matching `bool`.
  Either property alone is consistent, which is what said the combination was the
  bug. Two things a counter does not escape, because no type escapes them: a
  non-string `default` passes through untouched, and a negated twin sharing the
  destination writes `false` -- which is why inference types that pair as
  `number | boolean`. See `test/parser/options.test.ts`.
- **A required option rejects a missing or empty value; an optional one gets
  an empty string.** `--name` and `--name=` throw for `<value>` and yield `''`
  (or `0`, per the data type) for `[value]`.
- **`bool` is strict and symmetric.** `true`/`t`/`yes`/`y`/`on`/`1` are
  true, `false`/`f`/`no`/`n`/`off`/`0`/`''` are false, case-insensitively,
  and anything else throws. It does not follow minimist's
  "anything but `'false'`" rule, which made `--flag=0` true, nor
  yargs-parser's "only `'true'`", which makes `--flag=1` false. Every other
  data type already rejects input it cannot parse, and `0`/`1` is the usual
  convention for boolean environment variables.
- **Flags default to `false`, or `true` when negated — never `undefined`.**
  Commander leaves an unspecified flag undefined. A declared flag here always
  has a value, so `argv.verbose` is safe to read without a guard.
- **A bare positional name is optional; `<name>` is required.** Commander
  treats a bare name as required. Brackets are the only thing that decides it
  here, which keeps `args` readable at a glance.
- **String `default`s and environment values are coerced to the declared
  type.** So `default: 'yes'` on a flag is `true`, not `'yes'`, and a value
  the type rejects throws — `default: 'black'` on a flag is an error, the
  same way a default of `'nope'` on an `int` is. Non-string defaults pass
  through untouched.
- **The option format string is loose on purpose.** Extra short or long names
  become aliases rather than errors, and a bare word declares `--word`.
  Commander rejects all of those. Genuinely malformed parts — `-ws`,
  `---triple` — still throw.
- **An option and its negated twin share a destination, and the valued one
  owns it.** `'--cheese <type>'` plus `'--no-cheese'` is one destination set
  by two options, as in Commander. Unlike Commander it is order-independent,
  which costs the negated flag its implied `true`: the valued twin decides the
  default, so the pair is `undefined` until something sets it rather than
  silently `true`. A `default` declared on the flag is still honored, and
  `negate: false` opts out of the pairing. See `test/parser/options.test.ts`.
- **`main2()` handles errors instead of rejecting.** A thrown value from
  `parse()` or from the command's `run()` is rendered by `errorHandler()` —
  the message, never a stack — `process.exitCode` is set, and `main2()`
  resolves with `undefined`. Its caller is a bin script, so an unhandled
  rejection dumping a stack is the wrong default. `settings.errorHandler:
false` rethrows instead; a function replaces the handler.
- **A `beforeError` hook may replace the error but never suppress it.**
  Returning nothing leaves the error alone, returning a value makes that value
  the error, and a hook that throws is logged and skipped. Suppression would
  have to mean something different at every throw site — what `parse()`
  returns, whether the command still runs — and a rule that cannot hold
  everywhere is worse than no rule. Hooks fire for every throw site, inside
  `parse()` for what `parse()` throws and inside `main2()` for everything
  else, innermost command first and the schema last, before rendering and
  before the `errorHandler: false` opt-out. See `test/parser/hooks.test.ts`.
- **A `default` command is dispatched whenever argv named no command, even
  when it declares required arguments.** `default` means the name is implied,
  not that the command is a fallback that steps aside when the arguments are
  inconvenient — so `mycli` with a default `build <entry>` reports
  `Missing required arguments: <entry>` rather than silently doing nothing.
  Only applying it when there are no positionals would also make
  `mycli out.js` an `Unexpected argument`, which is the case a default command
  exists for. Two siblings both marked `default` throw while the schema is
  built; picking one would pick it by registration order. See
  `test/parser/default-command.test.ts`.
- **Undeclared options produce values rather than erroring.** `--foo` is
  `foo: true`, `--foo bar` is `foo: 'bar'`. They resolve after every command
  has been matched, coerce with `auto`, do not read `no-` as negation, and do
  not reach `state._`. `settings.allowUnknownOptions: false` restores the
  `Unknown option` error.
- **The first bare label in a command name is the name; the rest are
  aliases.** `'build, b'` and `'build b'` declare `build` aliased `b`. A `@` or
  `!` prefixed label is always an alias and names the command only when there
  is no bare label, so `'@ls, list'` is named `list` while `'@b'` alone is
  named `b`. Covered by `test/parser/regressions.test.ts`.
- **A `!` name prefix and an explicit `hidden` are additive.** Either one
  hides a command; an explicit `hidden: false` does not un-hide a `!` prefixed
  name — drop the `!` instead. That holds for a lazily loaded command too: the
  placeholder carries the `!`, the module never sees it. A command that
  declares neither always reads back `hidden: false`, never `undefined`, and a
  non-boolean `hidden` throws. `!` on any label hides the whole command, not
  just that one alias; an alias that should stay out of help without hiding
  the command belongs in the `alias` property, which never reaches the help
  label. Covered by `test/parser/regressions.test.ts`.

- **A command is fixed once it is initialized, and its declaration containers
  are read-only.** `cmd.args`, `cmd.commands`, and `cmd.options` echo the
  declaration; the parser reads the normalized arguments and the registries at
  `cmd[Internal]`, which are a different shape on purpose. Assigning,
  deleting, or adding to one of those three throws rather than silently
  failing to reconfigure a built command. A hook changes a command through the
  registries it is handed — `options.add()`, `args.push(initArg(...))`,
  `commands.add(await initCommand(...))` — which take effect immediately. The
  Proxy `set` traps that used to stand in for this could never have worked:
  building a command or an option is async and a `set` trap is not. The same
  line is drawn on options and arguments: `choices`, `default`, `multiple`,
  `required`, `transform`, and `type` are read on every parse and are editable
  in place, while `alias`, `env`, `format`, `name`, and `negate` built the
  registry lookups and the destination, so they are read-only too. Covered by
  `test/parser/schema.test.ts`.

### Help

- **`--help` and a `help` command are added to the root, and only where the app
  left room.** Options resolve across the whole context chain, so one `--help`
  on the root answers everywhere. Nothing is added over the top of a
  declaration: an app whose `-h` means `--host` keeps it and gets `--help`
  without the short form, and an app that declares `--help` itself gets neither
  the flag nor the short-circuit, because it owns what `--help` means.
  `schema.help: false` adds nothing at all. See `test/help/wiring.test.ts`.
- **The help flag's value never reaches `argv`.** A flag always has a value, so
  an added `--help` would put `help: false` on every app's parsed values. The
  option is marked `parserOwned` and is skipped by both fallback passes and by
  the write in `processArgs()`. An app that declares `--help` itself owns the
  value, and that one does reach `argv`.
- **Help wins over a missing required option or argument, and nothing else.**
  `parse()` detects the request after walking argv and before validating, so
  `mycli build --help` answers what `build` needs instead of complaining that it
  was not given. An _invalid_ value still throws: it failed on the way in, while
  argv was being read, and there was never a question to answer.
- **`--help` with no command named describes the program, not the default
  command.** A default command is in the context chain without argv having named
  it, and answering with its screen would hide every other command there is. The
  chain is trimmed to the commands argv actually named -- one `ParsedCommand`
  each, none for a default.
- **An option's `group` makes a section; a `help` hook contributes one.** Both
  are the same idea -- a titled list of options -- and they differ in what they
  are for. A group is the command's own options, split up, and still shadows
  what it inherits. A contributed section is shown and not parsed, which is the
  whole reason it exists: a `build` command has to describe every platform's
  options while only the platform that was named may parse. Options that should
  do both are added to the registry by a `parse` hook, which already works.
  Sections come after the command's own groups and before the inherited options,
  in the order they were added, and only the described command's hooks fire --
  an ancestor's sections would appear under a command that has nothing to do
  with them. See `test/help/sections.test.ts`.
- **A section title and a `group` are checked, and `Global` is taken.** Either
  becomes a heading on a line of its own, so a newline or a control character in
  one is rejected while the schema is built rather than when somebody asks for
  help, and surrounding whitespace is trimmed. `Global` is refused because help
  writes `Global options` itself and two headings of one name on a screen
  describe options in different scopes. A `group` mutated after init into
  something that cannot be a heading gets no heading rather than a broken
  screen, which is the same call `format()` makes for a default that cannot be
  written as JSON.
- **A section used twice is one section.** Two platforms sharing a title, or a
  hook that ran twice, add to what is there. The argument rules are about the
  list, so they are applied to the whole of the merged one, and nothing is kept
  until everything validated -- an `add()` that throws leaves the section it was
  merging into alone.
- **Shadowing counts every option, including a hidden one.** Being hidden is
  about whether help lists an option, not about whether it resolves: a command
  with a hidden `--mode` is still the `--mode` that argv reaches, so the root's
  is not what to describe.
- **A `help` hook that asks for the help it is contributing to is refused.** It
  is handed the state, which is all `resolveHelp()` needs, so it is an easy
  mistake and a stack overflow is a poor way to find it. What such a hook wants
  is `Command.help`, which is handed the generated screen.
- **A string `Command.help` builds no screen and fires no hook.** It replaces
  the screen outright, so a command that writes its own help cannot be stopped
  by a hook failing on the way to not using the generated one.
- **`HelpHookData` does not spread `InternalCommandBase`**, unlike every other
  command hook's data, because that carries a `state` of its own -- the
  command's `InternalState` -- and what a help hook wants under that name is the
  parse state. The registries worth having are named instead.
- **Help sorts commands and does not sort options.** Options are registered in
  the order the schema wrote them. Commands are registered as their
  initialization resolves, and one with subcommands of its own resolves after
  its siblings, so the registry's order is not the schema's and sorting is the
  only stable thing to print.
- **A lazily loaded command appears in help by name alone** until its module is
  read, because its description and its `hidden` are in that module. Hiding one
  is what the `!` name prefix is for. `help <command>` does load the module,
  since it is describing that one command.

### Sharing options between commands

- **Nothing declares what a command inherits, because nothing has to.** Options
  resolve across the whole context chain, so a child sees its parent's; the tree
  the parser walks is the only place that relationship lives. Help reads the same
  chain -- the described command, then each ancestor outward, with what is left
  under `Global options` -- so there is no second mechanism to keep in agreement.
  An earlier `inherits` property was added so that _inference_ could reach a
  parent, and removed again: it was a claim about the schema that the schema
  already made, it needed a runtime check of its own to stay honest, and it bought
  types that spreading a group into the command's own options also buys.
- **`options()` is the identity function.** It exists for the types: a `const`
  type parameter keeps `type: 'int'` from widening to `string`, so a group is
  still worth inferring from wherever it is used.

### Type inference

- **`src/infer.ts` is `initOption()` and `initArg()` written again in the type
  system.** That is the cost and there is no way around it: knowing that
  `'--port <n>'` with `type: 'int'` produces a non-optional `port: number` means
  reading the format string the way the parser reads it. The rules there move
  when those functions move, and `test/infer.test.ts` pins the pairs that are
  easy to get wrong -- including negative cases, since `unknown` and `any`
  satisfy any assertion and would otherwise make the whole file vacuous.
- **Inference happens at a call, not at a literal.** A nested object literal is
  checked against the declared type of the property it sits on, and checking does
  not re-infer that type's parameters. So `command()` is a function rather than a
  type: a bare literal inside `commands` keeps `Record<string, unknown>` and a
  wrapped one gets the narrow `argv`. Wrapping is optional and per command.
- **Anything wide contributes `Record<string, unknown>`, and that is deliberate.**
  An index signature in an intersection makes every key on it `unknown`, which is
  the honest answer when nothing was narrowed. `any` is checked first and counts
  as wide -- it arrives through `AnyCommand`, and left alone it satisfies the
  tuple walk and recurses on itself forever.
- **`AnyCommand` is `Command<any, any>`, not the wide defaults.** A command
  whose `run` takes a narrow `argv` is not assignable to one whose `run` takes a
  wide one, because a function parameter is contravariant, so every `commands` map
  would reject its own contents.
- **`choices` is `readonly unknown[]`.** `as const` is what produces a literal
  union, and a readonly array was not assignable to `unknown[]` -- which silently
  failed the constraint and made the whole declaration read as wide.
- **Nothing in `src/infer.ts` imports anything.** The rules read the shape of a
  declaration rather than its declared type, so `types.ts` imports it without a
  cycle.
- **The inference does not decide whether a schema is valid.** A variadic argument
  that is not last, `type: 'count'` on a valued option, and a format the parser
  rejects such as `'---triple'` are all things it throws on, and the types describe
  them as though they had worked. Validity is the parser's to report, with a
  message that says what to do; a type error would say less, and the code never
  runs either way.
- **A command's own declaration is typed and everything else in `argv` is
  `unknown`.** `InferArgv` intersects what it read with `Record<string, unknown>`
  rather than merging it: a merge would spread the index signature over the
  declared keys and make those `unknown` too. The keys it cannot see are the ones
  the commands above declared, which do resolve at runtime -- a command is typed at
  its own `command()` call and nothing there knows where in the tree it will be
  mounted -- so an error about a value that is genuinely there would be the wrong
  answer. A command that wants them typed spreads the group into its own options,
  and pays for it by shadowing what is above and moving those rows out of
  `Global options`.
- **A destination two sources share is merged, not intersected.** An `&` of a
  `boolean` and a `string` on one key is `never`, a key nothing can be assigned to,
  and an option and a positional argument of the same name really do both write to
  one destination. A shared key holds the union and is always there if either
  source fills it.
- **A declared `format`, `name`, or `hint` is read**, because `initOption()` reads
  all three and each changes the answer: a `format` wins over the key it was
  written under, a `name` wins over what the format would have named, and a `hint`
  makes a flag valued.
- **A default fills a destination whatever else was said**, including alongside
  `required: false`, which stops the parse demanding the option without stopping
  the fallback filling it. `default: undefined` is not a default -- `applyFallback()`
  skips it.
- **The rules that are easy to get wrong, and are therefore pinned by a test that
  also parses argv to confirm:** `choices` gives an option an implied hint and so
  makes it _valued_ rather than a flag; an empty `choices` list is `never`, because
  the parser rejects every value against it; `required` written out wins over what
  `<>` or `[]` implied, in both directions; only a _flag_ is negated and only when
  `negate` is not `false`, so `'--no-cheese [type]'` lands on `noCheese`; the first
  part of a format that is a long name or a bare word names the option, so position
  decides it and `'verbose, --all'` is `verbose`; a dual option is one destination
  holding either value and is optional, because the negated flag's implied default
  gives way to its valued twin; a pair of _flags_ on one destination is always set,
  because the positive one's default still applies; an optional argument before a
  required one is promoted; and `multiple`, `required`, `type`, and `choices`
  written out on an argument object are all read.

## Known bugs

- A subcommand's option used before its subcommand is not protected from being
  consumed as an earlier option's value, because it is not declared yet on the
  pass that reads it. A default command's options are always in that position,
  since it joins the chain only after argv has been walked. See the warning in
  `docs/parser.md` and the pinned tests in
  `test/parser/default-command.test.ts`.

## Conventions

- ESM only. Imports use `.js` extensions even for `.ts` sources.
- Internal state hangs off the exported `Internal` symbol, not enumerable
  properties, so schema objects stay clean for consumers. `parse()` stashes the
  state it died with on the error it throws the same way, under `ErrorState`,
  so the error path can still reach the matched command.
- **`init*()` copies, never decorates.** The caller's schema, commands, args,
  and options are read-only inputs: every normalized value and the `Internal`
  symbol land on a new object the library owns. So the same schema object
  parses identically any number of times, a frozen schema parses, and a lazily
  loaded command module — which the ESM loader shares with every other
  importer — is merged into a copy rather than written to. Asserted in
  `test/parser/schema.test.ts`.
- **No Proxies.** Internal commands, arguments, and options are plain objects.
  Anything that has to stay in sync is built once by `init*()`; anything a
  consumer may change afterwards is a property nothing is derived from.
- Parser errors are thrown as plain `Error`s with user-facing messages; they
  are what the user sees, so write them accordingly.
- Prefer a regression test named after the defect over a comment explaining it.
