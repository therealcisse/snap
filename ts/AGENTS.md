# Snap — TypeScript implementation

Implement the contract in `SPEC.md`; the language-neutral public tests under
`tests/` are the acceptance criteria. Architectural decisions are recorded in
design `snap-ts-architecture` (`dev-docs/designs/approved/`); toolchain
rationale is in research `ts-toolchain-conventions`. Read the design before
adding a module.

## Setup, build, run, and test

```bash
npm ci
npm run check                    # format:check, lint, typecheck, unit tests
npm run build                    # type-check only (tsc --noEmit)
npm test                         # unit tests (node --test)
npm start -- <arguments>         # run the CLI
./snap <arguments>               # executable used by the public harness
```

Run the language-neutral acceptance suite from the repository root:

```bash
./verify --lang ts
```

`npm run check` is the pre-commit gate and must pass before any commit that
touches `ts/`. Unit tests supplement the YAML suite; they never replace it.

## Layout

One responsibility per file under `src/`: `core/` (bytes, errors, version,
strict JSON), `text/` (tokens, edit scripts, diff, transform), `repo/` (model,
tree, validate, replay), `fs/` (locate, worktree, materialize), `http/`
(snapshot server, repository client), `commands/` (one file per command, pure:
arguments in, output record out — `serve.ts` is the one sanctioned exception:
long-running, prints its own startup URL, resolves when a signal ends it; a body
may return `Promise<CommandOutput>` when its operand needs the async §9 HTTP
client, as `merge`'s can), `cli/` (args, presentation, main; `execute` awaits
the promise so emission stays synchronous). Unit tests are colocated as
`src/**/*.test.ts`.

## Conventions

Production code uses Node built-ins only; everything else is a dev dependency.
The rules below exist because the idiomatic JavaScript default produces bytes
that violate `SPEC.md`. Most are enforced by `eslint.config.js`; the rest are
reviewed by hand.

- Never `JSON.parse` repository, config, or HTTP input. The single sanctioned
  decoder is `src/core/json.ts`; it rejects duplicate keys, non-integer or
  unsafe numbers, and unknown fields.
- Never order user-visible strings with `<`, `localeCompare`, or a
  comparator-less `sort`. Use the byte-order comparator in `src/core/bytes.ts`
  for paths, contributor IDs, changes, and warnings.
- File contents are `Uint8Array` end to end. Detect text with `isText`
  (valid UTF-8, no NUL); decode with `TextDecoder` using
  `{ fatal: true, ignoreBOM: true }`. Never `toString('utf8')` as a probe.
- Key every `Map`/`Set` by a version's canonical string, never by the array.
- Materialize a patch's base through the replay memo; never write a recursive
  un-memoized `materialize`.
- All stdout/stderr writes go through `src/cli/main.ts` via `fs.writeSync`.
  Never `process.exit()` after a write; set `process.exitCode` and return.
  Never `console.log`/`console.error` in `src/`.
- HTTP uses `node:http`/`node:https` directly, never global `fetch`.
- Synchronous `fs` everywhere except `--serve` and the HTTP client.
- Relative imports always carry the `.ts` extension; built-ins always use the
  `node:` prefix. No `enum`, namespaces with values, or parameter properties
  (`erasableSyntaxOnly`).
- No `any`; no non-null assertions outside `*.test.ts`. Every `switch` over a
  union is exhaustive without a masking `default`.
- Exported functions declare parameter and return types explicitly.
- Formatting is Prettier (`.prettierrc.json`): width 100, single quotes,
  trailing commas, LF. Never change these options; it destroys blame.
- Keep the module graph small and free of top-level work; the harness starts
  roughly 300 processes with a cold `tsx` cache.
