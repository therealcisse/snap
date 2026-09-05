---
title: "§7.11 terminal presentation: render every landed layout in plain and terminal modes"
date: 2026-09-05
author: agent
id: terminal-presentation
issue: terminal-presentation
research: []
designs:
  - snap-ts-architecture
completed: 2026-09-05
closeout_notes: true
---

## Context

Issue `terminal-presentation`: presentation selection is landed (`resolveModes`), but every command prints plain regardless of the selected mode, so terminal users get no §7.11 presentation and `tests/28-terminal-presentation.yaml` cannot pass. This plan makes the resolved modes actually render: commands stop preformatting plain bytes and instead return a structured result record; `cli/presentation.ts` gains the two §7.11 renderers (plain, terminal) over that record; `cli/main.ts` renders per-stream and keeps every existing byte of plain output identical. Warnings get their rendering forms now (merge's §6.4 producer lands with the merge strand, per the issue's boundary); `config` stays silent and the `--serve` startup URL stays plain. Selection must never change execution, effects, warning selection or order, or exit status.

## Current State

- `ts/src/cli/presentation.ts` — `resolveModes(env, isStdoutTty, isStderrTty)` implements the §7.11 truth table (lines 29–51); its header states rendering is deliberately absent. `presentation.test.ts` covers only resolution.
- `ts/src/cli/main.ts` — `run` (lines 44–63) calls `resolveModes` and discards the result ("take effect when rendering lands", lines 47–49); `emit` (118–121) writes `output.stdout`/`output.stderr` verbatim; `serve` receives the raw stdout sink (53–54); the catch path writes `describeFailure(failure).line` plain (58–62).
- `ts/src/commands/output.ts` — `CommandOutput { stdout: string; stderr: string }`: preformatted plain bytes.
- Command bodies build plain strings inline: `init.ts:39` (`()\n`), `commit.ts:115` (`writeRepositoryVersion`), `revert.ts:57` (version line), `status.ts:23` (`version <v>\n` + `<A|M|D> <path>\n` rows), `log.ts:23` (TSV lines with §7.4-escaped messages), `diff.ts` private `render` (47–109) building the §7.6 block, `version.ts:11`, `config.ts` silent. Their colocated tests assert these plain strings.
- No `warning:` producer exists anywhere in `ts/src` (grep: none) — §6.4 warnings arrive with the merge strand. `core/errors.ts` `describeFailure` returns the one-line `snap: <detail>\n` (or `snap: internal error: …\n`, exit 2).
- `serve.ts:54` already prints the URL through the CLI's raw sink, plain by construction (design decision 9).
- `tests/28-terminal-presentation.yaml` exists (env `SNAP_COLOR=always`; also pins `never`, `NO_COLOR`, empty-`NO_COLOR`, invalid-value plain error, plain serve URL, trailing-space path/message cases, binary and no-newline diff lines, and the merge rows). Worktree base is main `49ee47b` with 19/32 suites green; tests/28's plain-mode steps already pass, its terminal-mode steps fail.

## Developer Feedback

No interview was held: §7.11 fixes every terminal layout byte-for-byte and design `snap-ts-architecture` already fixes module placement (`cli/presentation.ts` — "§7.11 plain and terminal rendering"; `cli/main.ts` — the one write point). Decisions made in this plan:

- **One plan** (agent): like the four previous stack issues; the work is one seam (record → renderers → boundary wiring) with a single acceptance target.
- **Commands return structured result records; renderers own layout** (agent, per design): `CommandOutput` strings become the *renderer's* product. Rejected: re-parsing plain bytes at the boundary — plain success lines carry no label (`init`/`commit`/`revert` all print only the version), so the boundary needs command semantics anyway, and parsing would create a second, fragile owner of the plain layout.
- **`CommandOutput` shape retained** (agent): the `{stdout, stderr}` pair stays as what rendering produces; command unit tests switch to asserting records, and the plain byte goldens move to `presentation.test.ts`. Rejected: commands returning both a record and preformatted strings (two truths for one layout).
- **`diff` stays preformatted text** (agent, spec-shaped): §7.11 defines terminal diff as a line-classified transform of the plain block (`--- `/`+++ `→1, `@@ `→36, `-`→31, `+`→32, `\ `→2, `Binary files `→33; other lines unchanged), so `diff.ts` keeps its private `render` and returns `{kind:'diff', text}`. Rejected: typing every diff line (a transform the spec itself defines textually).
- **Warnings: forms now, producer later** (agent, per issue boundary): the record and both renderers support warning details (plain `warning: <detail>\n`, terminal `S(33,"⚠") + " " + S(33,detail) + LF`); no command populates them until merge lands. Rejected: implementing any §6.4/§7.8 machinery here (merge strand owns it; scope discipline).
- **Serve bypasses rendering** (agent, design decision 9): the startup URL keeps flowing through the raw sink, plain under `SNAP_COLOR=always`; serve's startup failures still funnel through the shared error path (rendered by stderr mode).
- **The invalid-`SNAP_COLOR` error stays plain** (agent, §7.11): it falls out naturally — mode resolution runs first and throws before any mode exists, so the catch path renders plain whenever modes are unknown.
- **Terminal symbols are the spec's exact codepoints** (agent): `✓` U+2713, `⚠` U+26A0, `✗` U+2717, `●` U+25CF, and minus `−` U+2212 (not hyphen-minus) for deleted rows — unit goldens assert the bytes.
- **Green target** (user, from the issue): tests/28 green for every landed command; its merge rows complete when the merge strand lands. The stack item stays unchecked until then.
- Carried from the `cli-skeleton-and-configuration` plan (user): all rendering — including layouts that already existed — lands in this section; `--version` reports `snap 1.0.0`.

## Approach

### Step 1 — `ts/src/commands/output.ts`: the result record

```ts
export type ChangeCode = 'A' | 'M' | 'D';
export interface StatusRow { readonly code: ChangeCode; readonly path: string }
export interface LogEntry { readonly version: string; readonly author: string; readonly message: string } // §7.4-escaped
export type SuccessLabel = 'Initialized repository' | 'Committed' | 'Reverted' | 'Merged';
export type CommandResult =
  | { kind: 'version'; semver: string }
  | { kind: 'config' }                                   // silent in both modes
  | { kind: 'success'; label: SuccessLabel; version: string }  // init/commit/revert (merge later)
  | { kind: 'status'; version: string; rows: readonly StatusRow[] }
  | { kind: 'log'; entries: readonly LogEntry[] }
  | { kind: 'diff'; text: string };                      // preformatted §7.6 block
// CommandOutput { stdout, stderr } remains, now produced only by rendering.
```

`init` returns `{kind:'success', label:'Initialized repository', version:'()'}`; `writeRepositoryVersion` takes the label as a parameter (`commit` passes `'Committed'`, `revert` `'Reverted'`); `status`/`log` return rows/entries instead of joining strings; `diffWorktree`/`diffVersions` return `{kind:'diff', text: render(delta)}`; `showVersion` returns `{kind:'version', semver: SEMVER}`; `setContributorId` returns `{kind:'config'}`.

### Step 2 — `ts/src/cli/presentation.ts`: the two renderers

`resolveModes` unchanged. Add `sgr(n, text)` (`ESC[` + decimal + `m` + text + `ESC[0m`) and:

```ts
export function render(result: CommandResult, modes: StreamModes, warnings: readonly string[] = []): CommandOutput
```

- **Plain** reproduces today's bytes exactly: success → `version + '\n'`; status → `'version ' + version + '\n'` + rows `code + ' ' + path + '\n'`; log → `version + '\t' + author + '\t' + message + '\n'` per entry; diff → `text`; version → `'snap ' + semver + '\n'`; config → `''`; warnings → `warning: <detail>\n` per detail.
- **Terminal** applies §7.11: success → `S(32,"✓") + " " + S(1,label) + " " + S(36,version) + LF`; status header `S(1,"Snap status") + "  " + S(36,version) + LF + LF`, clean row `"  " + S(32,"✓") + " Working tree clean" + LF`, dirty row `"  " + S(color,symbol) + " " + path + " " + S(2,"(" + label + ")") + LF` with `(A→32,"+","added")`, `(D→31,"−","deleted")`, `(M→33,"~","modified")`; log entry `S(36,"●") + " " + S(1,message) + LF + "  " + S(36,version) + " " + S(2,"by") + " " + S(35,author) + LF`, one bare LF between entries; diff → the line-classified transform (wrap each line's text excluding LF by first applicable prefix; context and unrecognized lines unchanged; empty text stays empty); version → `S(1,"snap <semver>") + LF`; warnings → `S(33,"⚠") + " " + S(33,detail) + LF`.
- stdout content renders by `modes.stdout`; stderr content (warnings) by `modes.stderr`.

### Step 3 — error lines and the boundary, `ts/src/cli/main.ts`

Add `renderErrorLine(line, mode)`: plain → `line` unchanged; terminal → `S(31, "✗ " + line-without-final-LF) + LF`. In `run`: resolve modes once and keep them (undefined on resolution failure); dispatch as today; `emit` becomes `render(result, modes, warnings)`; the catch path writes `renderErrorLine(describeFailure(failure).line, modes?.stderr ?? 'plain')`. `serve` is untouched — its URL already bypasses rendering. Execution, effects, and exit codes are byte-identical in both modes; only the printed bytes differ.

### Step 4 — unit tests

- `commands/*.test.ts` (version, init, config, status, log, commit, revert, diff): assert `CommandResult` records instead of plain strings (same fixtures).
- `cli/presentation.test.ts`: plain goldens (byte-exact, every kind — these become the plain-mode regression net); terminal goldens for every §7.11 form, including the U+2212 deleted symbol, trailing-space path and escaped-message cases from tests/28, binary/no-newline diff lines, empty diff, multi-entry log spacing, clean-vs-dirty status; mixed modes (terminal stdout + plain stderr and vice versa); `renderErrorLine` both modes; empty warnings → empty stderr in both modes.
- `cli/main.test.ts`: `SNAP_COLOR=always` end-to-end wiring for one stdout command and one error; `never` plain; invalid `SNAP_COLOR` error plain; serve URL plain under `always`.

### Step 5 — verify

`cd ts && npm run format && npm run check` green; `./verify --lang ts` from the root: every currently-green suite stays green (plain mode is untouched), tests/28 passes every step up to its merge-dependent rows.

## Tasks

- [ ] Extend `ts/src/commands/output.ts` with `CommandResult` and its member types per Step 1.
- [ ] Convert `ts/src/commands/version.ts`, `init.ts`, `config.ts`, `status.ts`, `log.ts` to return records per Step 1.
- [ ] Convert `ts/src/commands/commit.ts` (`writeRepositoryVersion` label parameter) and `revert.ts` per Step 1.
- [ ] Convert `ts/src/commands/diff.ts` to return `{kind:'diff', text}` (private `render` unchanged).
- [ ] Add `sgr`, `render`, and `renderErrorLine` to `ts/src/cli/presentation.ts` per Steps 2–3.
- [ ] Rewire `ts/src/cli/main.ts`: keep resolved modes, render before emit, mode-aware error path per Step 3.
- [ ] Update the seven `commands/*.test.ts` files to record assertions per Step 4.
- [ ] Extend `ts/src/cli/presentation.test.ts` and `ts/src/cli/main.test.ts` per Step 4.
- [ ] Run `cd ts && npm run format`, then `npm run check`; fix until green.
- [ ] Run `./verify --lang ts` and confirm: no regressions among the 19 green suites; tests/28 green through its merge rows; `--list` = 32.

## Documentation Impact

- `SPEC.md`, `tests/`: none expected — §7.11 and tests/28 already fix the behavior; if implementation reveals an ambiguity, correct the spec first or in the same commit with a YAML regression case (root `AGENTS.md`).
- `ts/AGENTS.md`, root `AGENTS.md`, `README.md`: none — the Layout section already names `cli/presentation.ts` as the rendering owner, and README's color paragraph already matches §7.11.
- Stack `snap-1.0` "Terminal presentation": stays unchecked at `/close-issue` until tests/28 is fully green (merge rows); this plan lands everything else.

## Acceptance Tests

- `cd ts && npm run check` exits 0.
- `./verify --lang ts`: the 19 suites green at base stay green; `--filter 28-terminal-presentation` passes every step up to the merge-dependent rows (merge rows fail with merge's `not implemented` line — the merge strand completes them); `--list` = 32.
- `SNAP_COLOR=always ./ts/snap --version` prints `ESC[1msnap 1.0.0ESC[0m` + LF; `SNAP_COLOR=never` prints `snap 1.0.0\n`; unset with piped stdout prints plain.
- `SNAP_COLOR=bogus ./ts/snap --version` prints the plain `snap: SNAP_COLOR must be auto, always, or never\n`, exit 1.
- In a repository under `SNAP_COLOR=always`, `./ts/snap status` (dirty) shows wrapped header and U+2212 deleted rows; `./ts/snap --serve 0` still prints the plain `http://127.0.0.1:<port>/repository.json` URL.
- Unit goldens pin plain bytes (byte-stability net) and every terminal form listed in Step 4, including per-stream mixed modes.
- `git diff --quiet SPEC.md AGENTS.md README.md ts/AGENTS.md` exits 0.
