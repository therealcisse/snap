---
title: "§7.11 terminal presentation realized: result records, two renderers, per-stream wiring"
date: 2026-09-05
author: agent
id: terminal-presentation
issue: terminal-presentation
plan: terminal-presentation
---

## Summary

§7.11 terminal presentation is live: commands stopped preformatting plain bytes and now return
structured `CommandResult` records; `cli/presentation.ts` owns the two renderers (byte-stable
plain and ANSI-SGR terminal) plus the error-line form; `cli/main.ts` resolves each stream's mode
once and renders before writing. Every landed command now renders both modes per SPEC §7.11;
plain-mode bytes are unchanged, `tests/28` passes every row it can until the merge strand lands
its final merge rows, and the 19 previously-green acceptance suites are untouched.

## Plan Realized

### terminal-presentation

Plan `terminal-presentation` (dev-docs/plans/approved/terminal-presentation.md) is realized in
full — all ten tasks landed as written, with two letter-level deviations:

- The plain-serve-URL-under-`SNAP_COLOR=always` pin lives in `ts/src/commands/serve.test.ts`
  (its real-server harness `startServe` gained an `env` parameter) rather than in `main.test.ts`
  as the plan's test list suggested; a spawned-process pin needs the real server.
- `main.test.ts`'s harness gained a `tty` override so the `SNAP_COLOR=never` wiring test runs
  against TTY streams — the interesting case — instead of pipes, where plain is the default.

## Implementation

- `ts/src/commands/output.ts` — the domain vocabulary: `ChangeCode` (A/M/D), `StatusRow`,
  `LogEntry` (§7.4-escaped message), `SuccessLabel` ('Initialized repository' | 'Committed' |
  'Reverted' | 'Merged'), and the `CommandResult` discriminated union (version, config, success,
  status, log, diff). `CommandOutput {stdout, stderr}` remains, now produced only by rendering.
- Commands return records: `version.ts` `{kind:'version', semver}`; `init.ts` success with
  'Initialized repository' and `'()'`; `config.ts` `{kind:'config'}` (silent); `status.ts`
  `{kind:'status', version, rows}`; `log.ts` `{kind:'log', entries}`; `commit.ts` and `revert.ts`
  share `writeRepositoryVersion(root, repository, patch, label)` returning the success record
  with 'Committed'/'Reverted'; `diff.ts` returns `{kind:'diff', text}` with its private §7.6
  `render` unchanged.
- `ts/src/cli/presentation.ts` — `resolveModes` unchanged; `sgr(n, text)`; `render(result, modes,
  warnings = [])` producing `CommandOutput` with `plainStdout`/`terminalStdout` switches;
  `ROW_STYLES` (A→32/'+', D→31/'−' U+2212/'deleted', M→33/'~'/'modified'); terminal status
  header `S(1,"Snap status") + "  " + S(36,version)` + blank line, clean row, dirty rows;
  `renderEntryTerminal` with entries joined by one bare LF; `DIFF_LINE_STYLES` first-prefix
  classes (--- /+++ →1, @@ →36, - →31, + →32, "\ " →2, "Binary files " →33) applied by
  `colorizeDiff`'s split/map/join, which preserves LF structure and a missing final LF;
  `renderWarning` (plain `warning: <detail>` LF, terminal S(33,⚠) + S(33,detail)); and
  `renderErrorLine(line, mode)` (plain unchanged; terminal S(31, "✗ " + line) + LF).
- `ts/src/cli/main.ts` — `run` resolves modes once into `StreamModes | undefined` (undefined on
  resolution failure), dispatches as before, `emit` renders then writes per stream, and the one
  catch path writes `renderErrorLine(describeFailure(failure).line, modes?.stderr ?? 'plain')`.
  The serve arm is untouched: its startup URL goes through the raw stdout sink, so it stays plain
  under `SNAP_COLOR=always`.

## Behavior

Selection follows §7.11 exactly: `SNAP_COLOR=always` forces terminal on both streams and
overrides `NO_COLOR`; `never` forces plain; unset/auto follows each stream's own TTY status
unless `NO_COLOR` is present with any value; any other value fails before execution with the
plain `snap: SNAP_COLOR must be auto, always, or never` line and exit 1. Rendering is
appearance-only: both modes execute the same command, produce the same record, write the same
repository/filesystem effects, route warnings to stderr in the same order, and exit with the
same status. Plain output is byte-identical to the pre-change bytes (the 19 green suites and
tests/28's plain rows pin this); terminal output matches tests/28's goldens, including ✓/⚠/✗/●,
U+2212 for deleted rows, trailing-space paths and messages, binary and no-newline diff lines,
and the blank line between log entries. `config` prints nothing in both modes; the serve URL
never carries SGR bytes.

## Tests

- `ts/src/commands/{init,config,status,log,commit,diff,revert}.test.ts` assert `CommandResult`
  records (same fixtures; log's escaped-message literal and revert's log history are preserved as
  record shapes).
- `ts/src/cli/presentation.test.ts` pins resolution (unchanged), plain goldens for every kind
  (the byte-stability net), terminal goldens for every §7.11 form, warnings in both modes,
  mixed per-stream modes (terminal stdout + plain stderr), and `renderErrorLine` in both modes
  including a line without its trailing LF.
- `ts/src/cli/main.test.ts` pins end-to-end wiring: terminal bytes under `always` (--version,
  init, usage error in red), plain under `never` on TTY streams, plain invalid-`SNAP_COLOR`
  error, plus the existing dispatch and serve-failure pins.
- `ts/src/commands/serve.test.ts` pins the plain startup URL under `SNAP_COLOR=always`.
- `cd ts && npm run check`: green — format, lint, typecheck, 417 unit tests, 0 failures.
- `./verify --lang ts`: 19 passed / 13 failed — the identical green roster as the base; every
  failing suite is merge-strand-owned or tests/28's merge row. `--filter
  28-terminal-presentation` passes every step except step 46 (`merge ../right` → not
  implemented). `--list` = 32.
- Known gap (deliberate): no `warning:` producer exists yet, so `render`'s warnings parameter is
  exercised only by unit tests until the merge strand lands §6.4/§7.8 warnings.

## Decisions

- Warning details flow as `render`'s third parameter rather than riding inside the result
  record: warnings belong to the invocation, not to any one command's success shape, and merge —
  their only future producer — can pass them at the boundary without widening `CommandResult`.
- `renderErrorLine` wraps the complete plain line, `snap:` prefix included, in a single red SGR
  wrap: §7.11 styles "a plain error line", and the prefix is part of that line, not decoration.
  It also emits exactly one trailing LF in terminal mode even if the input line lacked one, so
  terminal errors always end in a line break like their plain counterparts.
- The invalid-`SNAP_COLOR` error stays plain by construction — mode resolution runs first and
  throws before any mode exists, and the catch path falls back to `'plain'` when modes are
  undefined — rather than by a special case.
- `diff` terminal rendering is a line-classified transform of the plain text (the spec defines
  it that way) rather than typed diff lines; the split/map/join keeps every plain byte, leaves
  context and unrecognized lines alone, and preserves a missing final newline.
- Module-level import style follows the repo's `import-x/order` rule (value imports before type
  imports, groups separated), which the new type-only imports surfaced.

## Follow-Up

- The merge strand completes the remaining rows: the `'Merged'` success label, the §6.4 warning
  producer feeding `render`'s warnings parameter, and tests/28 step 46 — after which tests/28
  and the stack's "Terminal presentation" item can go green.
- Stack `snap-1.0` "Terminal presentation" stays unchecked at close-issue until tests/28 is
  fully green, per the plan's documentation impact.
- Plan `terminal-presentation`'s `realized_design`/`completed` metadata is filled by close-plan
  after this design is approved.
