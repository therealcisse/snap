---
title: "Realized design: stack snap-1.0 check-off of five merged items"
date: 2026-09-05
author: agent
id: stack-checkoff
issue: stack-checkoff
plan: stack-checkoff
---
# Realized design: stack snap-1.0 check-off of five merged items

## Summary

Issue `stack-checkoff` resolved a stale completion checklist: five items in stack `snap-1.0` were still unchecked although their work was implemented and merged into `main` at 33d97c5. The implementation re-verified every named acceptance gate in this worktree and then flipped exactly those five checkboxes to checked, leaving all other stack bytes untouched.

## Plan Realized

### stack-checkoff

Plan `stack-checkoff` (dev-docs/plans/approved/stack-checkoff.md) was realized exactly as written: all five tasks completed in order, no deviations. Evidence re-verification ran before any edit, and the edit surface was confirmed by diff to be five checkbox flips only.

## Implementation

The only file changed is `dev-docs/stacks/snap-1.0.md`. Five list items changed their leading marker from `- [ ]` to `- [x]`:

- Concurrent replay and merge section: the `snap merge <path>` item (validations, dot-keyed union with corruption detection, frontier join, joined replay, warning difference, dirty-tree refusal, validation before mutation).
- HTTP section: the HTTP repository operand item (single GET, status 200 required, no redirects, strict parse).
- HTTP section: the `snap merge <url>` item.
- Terminal presentation section: the §7.11 terminal rendering item.
- Hardening and performance section: the full-suite item (`./verify --lang ts` green, `npm run build` clean, harness checks unchanged).

No rewording, reordering, unchecking, or other edits anywhere in the file; no product code, tests, specs, or `AGENTS.md` files were touched.

## Behavior

Re-verification results recorded in this worktree before the edit:

- `./verify --lang ts` from the repository root: 32 passed in ~55 s, 0 failures.
- `cd ts && npm run check`: Prettier clean, ESLint clean, `tsc --noEmit` clean, 455/455 unit tests (95 suites).
- `cd ts && npm run build`: clean.
- `cd test-harness && npm run check && npm test`: `tsc --noEmit` clean, 11/11 tests.

After the edit, `grep -c '^- \[ \]'` on the stack file returns 0 (was 5) and `grep -c '^- \[x\]'` returns 62 (was 57); `git diff -- dev-docs/stacks/snap-1.0.md` shows exactly the five flipped lines.

## Tests

No new tests: this is a documentation-only change with no runtime behavior. The existing acceptance evidence was re-run, not modified — the YAML suite (32 cases), the TypeScript unit suite (455 tests), and the harness self-tests (11 tests) all pass unchanged. `tests/16-dot-collision.yaml`, `tests/20-dirty-merge.yaml`, `tests/26-portability-and-failure-safety.yaml`, `tests/13-http-client.yaml`, and `tests/28-terminal-presentation.yaml` — the suites cited by the five checked-off items — are all included in the green 32-case run.

## Decisions

- Re-run all evidence in the worktree before editing rather than trusting the issue's inherited claims, so the check-off records locally verified truth; the hardening item's own criterion is a green full run.
- Limit the edit to the five marker bytes (`[ ]` → `[x]`) even though adjacent prose could plausibly be "improved"; the stack is a durable record and the issue's scope is exactly the five stale items.
- Plain `mv` (not `git mv`) for the issue's backlog→open move, because the issue file is untracked and commits are out of scope; the directory-position lifecycle semantics are identical.

## Follow-Up

None. The stack now shows 62/62 items checked; no open items remain in `snap-1.0`, and this change introduces no new work. If the project later grows a round-3 scope, it belongs in a new stack or new items via the stack update command, not in edits to the completed record.
