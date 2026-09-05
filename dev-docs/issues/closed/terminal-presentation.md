---
title: §7.11 terminal presentation rendering
date: 2026-09-05
start-date: 2026-09-05
author: agent
id: terminal-presentation
stack: snap-1.0
closed: 2026-09-05
---

## Problem

Snap's output only ever comes out in its plain form. Someone running Snap in an interactive terminal never sees the styled presentation the spec promises for success lines, listings, warnings, and errors, because terminal-mode rendering has not been built: presentation selection exists, but every command prints plain regardless of the selected mode.

Implement §7.11 terminal presentation: terminal-mode rendering with the exact ANSI SGR forms for init/commit/revert/merge success lines, `status`, `log`, `diff`, `--version`, `warning:` lines, and error lines; `SNAP_COLOR=always` overrides `NO_COLOR`; `config` stays silent and the `--serve` startup URL stays plain; selection never changes execution, repository or filesystem effects, warning selection or order, or exit status. Plain mode must stay byte-stable. Target: tests/28 green for every landed command (the merge rows complete once the merge strand lands).

## Impact

- `tests/28-terminal-presentation.yaml` cannot pass, so the acceptance count stays below 32/32 and the "Terminal presentation" item of stack `snap-1.0` remains unchecked; the stack's final "Full `./verify --lang ts` green" item is blocked on it.
- Terminal users get no color-coded feedback: success lines, `status`/`log`/`diff` listings, warnings, and errors lose the readability the spec's terminal presentation exists to provide.
- The longer rendering lands late, the more output paths it touches are already pinned byte-for-byte by other suites, raising regression risk for plain mode.

## Context

- `SPEC.md` §7.11 is the canonical contract; §10 defers output presentation to §7.11's selection. The acceptance suite is `tests/28-terminal-presentation.yaml`.
- `ts/src/cli/presentation.ts` already resolves per-stream presentation (`SNAP_COLOR` / `NO_COLOR` / per-stream TTY, invalid `SNAP_COLOR` rejected before execution, `always` overriding `NO_COLOR`); its header states rendering is deliberately absent until this section lands. Output flows through `ts/src/cli/main.ts`.
- The YAML harness captures streams through pipes with no PTY, so terminal-mode cases are driven with `SNAP_COLOR=always`; plain-mode bytes must remain unchanged for every existing suite.
- The merge rows of `tests/28` depend on the merge strand; this issue lands rendering for every already-landed command and completes those rows when merge lands.

## Out of Scope

- Implementing the merge command or its replay machinery (separate strand; this issue only completes the merge rows of `tests/28` once that lands).
- HTTP behavior beyond keeping the `--serve` startup URL plain (owned by the HTTP strand).
- Any change to plain-mode bytes, command grammar, exit codes, or warning selection and order.
- New commands, options, or presentation surface beyond what §7.11 specifies.

## Plan Closeout Notes

<!-- plan-close-review: terminal-presentation -->

- Scope: no drift — all ten tasks landed as written; two letter-level test-placement deviations are recorded in realized design `terminal-presentation`: the plain-serve-URL-under-`SNAP_COLOR=always` pin lives in `ts/src/commands/serve.test.ts` (its spawned-process harness `startServe` gained an `env` parameter) instead of `main.test.ts`, and `main.test.ts`'s harness gained a `tty` override so the `never` case runs against TTY streams.
- Documentation impact: none beyond the plan's "none expected" — `SPEC.md`, `README.md`, root `AGENTS.md`, and `ts/AGENTS.md` are byte-unchanged (`git diff --quiet` clean).
- Guidelines / conventions: none recorded — no GUIDELINES files exist in this repo; the new type-only imports follow the existing eslint `import-x/order` lane (`npm run check` green).
- Comments / docstrings: conform.
- Stack items satisfied: none — `snap-1.0` "Terminal presentation" (§7.11, tests/28) stays unchecked by plan: tests/28 is green for every landed command, but its merge rows (step 46) await the merge strand; the 19-suite green roster is otherwise unchanged, so no other item's requirements were newly completed.

<!-- /plan-close-review -->
