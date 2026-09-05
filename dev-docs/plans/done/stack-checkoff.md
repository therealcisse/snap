---
title: "Check off five completed items in stack snap-1.0"
date: 2026-09-05
author: agent
id: stack-checkoff
issue: stack-checkoff
research: []
designs: []
completed: 2026-09-05
closeout_notes: true
---
# Check off five completed items in stack snap-1.0

## Context

Issue `stack-checkoff` records that `dev-docs/stacks/snap-1.0.md` is stale: five items remain `- [ ]` although their work is implemented and merged into `main` at 33d97c5, the base of this branch. This plan resolves the issue by re-verifying the completion evidence in this worktree and then flipping exactly those five checkboxes to `- [x]`. It is a documentation-only fix; no product code, tests, specs, or `AGENTS.md` files change.

## Current State

`dev-docs/stacks/snap-1.0.md` has 107 lines and exactly five `- [ ]` items, at:

- Line 87 (Concurrent replay and merge): `snap merge <path>` item citing `tests/16-dot-collision.yaml`, `tests/20-dirty-merge.yaml`, `tests/26-portability-and-failure-safety.yaml`.
- Line 93 (HTTP): HTTP repository operand item citing `tests/13-http-client.yaml`.
- Line 95 (HTTP): `snap merge <url>` item (§7.8).
- Line 99 (Terminal presentation): §7.11 terminal rendering item citing `tests/28-terminal-presentation.yaml`.
- Line 106 (Hardening and performance): full `./verify --lang ts` green, `npm run build` clean, `cd test-harness && npm run check && npm test` unchanged.

All other items in the stack are already `- [x]`. The named suites and commands exist: `./verify` at the repo root drives the YAML suite under `tests/`; `ts/AGENTS.md` defines `npm run check` (format:check, lint, typecheck, unit tests) and `npm run build`; `test-harness/` has its own `check` and `test` scripts. All four round-2 strands (merge-command, diff-repo, terminal-presentation, hardening) are merged at 33d97c5.

## Developer Feedback

The issue and codebase answer every design question, so no interview was needed; this is a forced, single-correct-fix plan (the skill's small-plan skip path).

Decisions:

- **One plan, not several.** The change is five checkbox edits in one file; splitting it would add ceremony without value.
- **Re-verify evidence before checking off.** The five items assert passing suites; the plan re-runs them in this worktree first so the check-off records verified truth, not inherited claims.
- **Exactly five line edits, `- [ ]` → `- [x]`.** No rewording, reordering, or additional check-offs; the issue's Out of Scope forbids touching anything else.

Rejected alternatives:

- **Check off without re-running the suites.** Rejected: the hardening item's own completion criterion is a green full run; checking it off on inherited claims would defeat the stack's evidentiary purpose.
- **Rewrite or reorder stack sections while editing.** Rejected: out of scope for the issue and destructive to stack readability.

## Approach

1. Re-run the acceptance evidence from the worktree root: `./verify --lang ts` (expect all 32 suites to pass).
2. Re-run the implementation gates: `cd ts && npm run check && npm run build` (expect both clean).
3. Re-run the harness gates: `cd test-harness && npm run check && npm test` (expect green, unchanged).
4. Edit `dev-docs/stacks/snap-1.0.md`: on lines 87, 93, 95, 99, and 106 only, change the leading `- [ ]` to `- [x]`. No other characters change.
5. Verify the edit surface with `git diff -- dev-docs/stacks/snap-1.0.md`: exactly five changed lines, each a `- [ ]` → `- [x]` flip; all other checkboxes untouched.

## Tasks

- [ ] Task 1. From the worktree root, run `./verify --lang ts` and confirm all 32 suites pass.
- [ ] Task 2. Run `cd ts && npm run check && npm run build` and confirm both succeed.
- [ ] Task 3. Run `cd test-harness && npm run check && npm test` and confirm both succeed.
- [ ] Task 4. Edit `dev-docs/stacks/snap-1.0.md` lines 87, 93, 95, 99, 106: `- [ ]` → `- [x]`, no other edits.
- [ ] Task 5. Verify with `git --no-pager diff -- dev-docs/stacks/snap-1.0.md` that exactly those five lines changed and each is a checkbox flip only.

## Documentation Impact

- `dev-docs/stacks/snap-1.0.md`: the only file changed; five checkbox marks flipped from `- [ ]` to `- [x]`.
- No changes to `SPEC.md`, `README.md`, `TEST-HARNESS.md`, `AGENTS.md` files, tests, or the YAML suite.

## Acceptance Tests

- `./verify --lang ts` from the worktree root: all 32 suites pass (Task 1).
- `cd ts && npm run check && npm run build`: both exit 0 (Task 2).
- `cd test-harness && npm run check && npm test`: both exit 0 (Task 3).
- `grep -c '^- \[ \]' dev-docs/stacks/snap-1.0.md` returns 0 after the edit, and `grep -c '^- \[x\]'` returns the previous count plus five (Task 4/5).
- `git --no-pager diff -- dev-docs/stacks/snap-1.0.md` shows exactly five changed lines, each changing only `- [ ]` to `- [x]` (Task 5).
