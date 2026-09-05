---
title: "CLI skeleton realized: §7 grammar, SNAP_COLOR resolution, init, config, --version, and the nearest-repository walk"
date: 2026-09-05
author: agent
id: cli-skeleton-and-configuration
issue: cli-skeleton-and-configuration
plan: cli-skeleton-and-configuration
---

## Summary

Snap is now a runnable program. Every invocation flows through the full §7 grammar, so usage
errors are final for all ten commands; `SNAP_COLOR`/`NO_COLOR` resolution runs (and rejects
invalid values) before any command; `init`, `config`, and `--version` have real bodies; and the
nearest-repository walk plus §8 local-over-global contributor resolution exist in `fs/locate.ts`.
The remaining command bodies still fail `not implemented`, but only after their shared
prerequisites — repository location and `<version>` operand validation — run for real.

## Plan Realized

### cli-skeleton-and-configuration

Plan: `dev-docs/plans/approved/cli-skeleton-and-configuration.md`. All nine tasks completed as
written. Seven refinable deviations, all recorded at implementation time:

1. `resolveContributorId(repositoryRoot, env)` takes the repository **root**, not a `startDir` —
   callers have already walked; this avoids a second walk and removes the
   outside-a-repository case from the function's contract.
2. `locate.ts` exports `nearestRepository` (an `undefined`-returning walk probe);
   `findRepositoryRoot` is its throwing wrapper. `init` uses the probe to detect the
   inside-repository case without exception control flow.
3. New `commands/output.ts` holds the shared `CommandOutput` interface (the plan declared the
   type but gave it no home).
4. The config command is exported as `setContributorId` (plan: `config`) — the domain action;
   `config` remains the CLI word.
5. `Command.repo` is `string | undefined` rather than an optional property
   (`exactOptionalPropertyTypes`).
6. Layout constants (`SNAP_DIRECTORY`, `LOCAL_CONFIG_FILE`, `GLOBAL_CONFIG_FILE`) are exported
   from `locate.ts` and reused by `commands/` — one owner of `.snap` layout knowledge.
7. An empty `$HOME` is treated as absent on both the read and write paths — joining against `''`
   would silently target the process working directory.

## Implementation

- `ts/src/cli/args.ts` — `Command`, a ten-member discriminated union, and `parseArgs`. Options
  occur exactly in their §7 positions, at most once; `--version` shares with nothing; `init`
  rejects leading-`-` paths; `commit`/`revert`/`merge` operands are verbatim; `--serve` ports are
  digits ≤ 65535 (default 8765). Uniform `invalid command or arguments`; the diff family throws
  its own `usage: snap diff <old> <new> [--repo <repository>]`.
- `ts/src/cli/presentation.ts` — `resolveModes(env, isStdoutTty, isStderrTty)` implementing the
  §7.11 truth table. No rendering, by decision (see Decisions).
- `ts/src/cli/main.ts` — rewritten around an injected `Context {out, env, cwd, isStdoutTty,
  isStderrTty}`. `run` resolves modes first, parses, dispatches, emits; failures still funnel
  through `describeFailure` to one `snap: <detail>` line and an exit code. Dispatch arms:
  `showVersion`/`init`/`config` call their commands; `status`/`log`/`commit`/`merge` walk first;
  `diff`/`revert` walk, `loadRepository`, and validate each operand via `requireKnownVersion`
  (`parseVersion` then a `knownVersionKeys` membership check) before `notImplemented(argv)`;
  `serve` is `notImplemented(argv)` directly. `ts/src/main.ts` builds the `Context` from
  `process` and sets `process.exitCode`.
- `ts/src/fs/locate.ts` — `nearestRepository`/`findRepositoryRoot` walk (a directory is a root
  when it contains a `.snap` directory), `loadRepository` (unreadable `repository.json` →
  `not a Snap repository`), `resolveContributorId` (§8 precedence), `encodeConfiguration`
  (two-space canonical form, trailing LF), and the pre-existing `decodeConfiguration`.
- `ts/src/repo/model.ts` — `EMPTY_REPOSITORY_JSON` (exact canonical bytes, spelled as a literal)
  and `knownVersionKeys` (`()` plus each patch's result version via a private `resultVersion`
  that sets the author component, replacing or inserting it in canonical order).
- `ts/src/commands/` — `output.ts` (shared record), `version.ts` (`SEMVER = '1.0.0'`),
  `init.ts` (both refusals precede any mutation), `config.ts` (`setContributorId`: ID validated
  first, then one canonical write to the nearest repository's file or `$HOME/.snapconfig.json`).

## Behavior

- Mode resolution precedes everything: an invalid `SNAP_COLOR` fails with
  `snap: SNAP_COLOR must be auto, always, or never` and exit 1 before grammar runs. `always` is
  accepted but output stays plain until rendering lands (spec-divergent, untested).
- `snap init [path]` prints `()\n`, creates the target recursively, and writes the exact
  empty-repository bytes; `repository already exists` / `cannot initialize inside repository`
  leave the filesystem untouched; working files are preserved.
- `snap config [--global] contributor.id <id>` is silent on success; `invalid contributor id:
  <id>` fires before any write; local writes outside a repository fail `not a Snap repository`;
  global writes without a usable `$HOME` fail `HOME is not set`.
- `snap --version` prints `snap 1.0.0\n`, exit 0, without locating a repository.
- Stub bodies keep their pinned orderings: repository commands outside a repository report the
  location failure; `diff`/`revert` inside one validate operands first (`invalid version`/
  `unknown version`) and only then report `not implemented: <argv>`.
- All stream writes remain synchronous through `fdOutput`; exit status is returned, never
  `process.exit`.

## Tests

- Unit: 215 tests in 34 suites, all green (`npm run check`). Coverage per the plan: the full
  tests/24 grammar matrix and tests/14 cases in `args.test.ts`; the §7.11 truth table including
  per-stream mixed `auto` and empty `NO_COLOR` in `presentation.test.ts`; exact bytes and both
  refusals in `init.test.ts`; canonical writes and every config failure in `config.test.ts`;
  walk/`loadRepository`/§8-precedence table in `locate.test.ts`; `EMPTY_REPOSITORY_JSON` and
  `knownVersionKeys` (replace and insert orders) in `model.test.ts`; context-based dispatch in
  `main.test.ts`.
- Acceptance: `01-init`, `02-init-paths`, `14-cli-errors`, `24-cli-grammar-matrix` green.
  `03-configuration` fails first at `commit local-wins`; `19-version-boundaries` fails first at
  `commit one`; earlier steps pass in both. `--list` = 32. CLI checks (`./ts/snap --version`,
  `SNAP_COLOR=bogus ./ts/snap --version`) and the documentation drift check all pass.

## Decisions

- Rendering deferred, resolution landed: `resolveModes` exists only to validate the invocation
  and to be the seam the Terminal presentation section wires into. This follows the plan's
  developer feedback (tests/28 owns rendering); the cost is that `SNAP_COLOR=always` currently
  prints plain, which the suites do not test.
- Validation lives in the dispatch layer, not stub command files: diff/revert operand checks sit
  in `cli/main.ts` (`requireKnownVersion`), so no `commands/{diff,revert}.ts` file exists until
  its real body lands — per the plan, avoiding throw-only stubs.
- `EMPTY_REPOSITORY_JSON` is a literal, not encoder output: the bytes are auditable in one
  place, and the general encoder belongs to the later Repository model section.
- A `.snap` directory without a readable `repository.json` is reported as `not a Snap
  repository`, collapsing "outside" and "unusable" into one error the suites already pin.
- `knownVersionKeys` recomputes per call; at repository sizes Snap targets this is irrelevant,
  and it keeps the function pure and side-effect free until a caller needs caching.

## Follow-Up

- Everyday-commands issue (next in stack): real bodies for `status`/`log`/`commit`/`diff`/
  `revert`/`merge`; finishes `tests/03` and `tests/19` and unchecks the two deferred stack items
  ("config … tests/03", "tests/14, tests/19 green").
- Terminal presentation section: all ANSI rendering, including for the plain outputs landed here
  (tests/28).
- `contributor.id is required` (§8) has its resolution machinery but no caller yet; `commit` is
  the first command that will raise it.
- `--serve` body belongs to the HTTP section.
