---
title: "Stack snap-1.0: five completed items remain unchecked"
date: 2026-09-05
start-date: 2026-09-05
author: agent
id: stack-checkoff
stack: snap-1.0
closed: 2026-09-05
plans:
  - stack-checkoff
---
# Stack snap-1.0: five completed items remain unchecked

## Problem

The stack `snap-1.0` no longer reflects the actual state of the project. Five of its checklist items are still marked unchecked even though the work they describe is implemented, merged into `main` at commit 33d97c5, and demonstrably passing its acceptance checks. Anyone reading the stack to see what remains for Snap 1.0 is misled into believing five strands of finished work are still outstanding.

Technically, `dev-docs/stacks/snap-1.0.md` still carries `- [ ]` on five items whose completion criteria are now satisfied on merged `main`: the `snap merge <path>` item in the Concurrent replay and merge section (citing `tests/16-dot-collision.yaml`, `tests/20-dirty-merge.yaml`, `tests/26-portability-and-failure-safety.yaml`), the HTTP repository operand item and the `snap merge <url>` item in the HTTP section (citing `tests/13-http-client.yaml` and §7.8/§9), the §7.11 terminal rendering item in the Terminal presentation section (citing `tests/28-terminal-presentation.yaml`), and the hardening item requiring full `./verify --lang ts` green, clean `npm run build`, and unchanged harness checks.

## Impact

The stack is the completion checklist that drives issue creation and close-issue stack updates. Stale unchecked items misdirect future planning: agents reading the stack may re-derive, re-plan, or re-implement work that is already merged, and close-issue rituals cannot reconcile the stack with reality. The stack also under-reports Snap 1.0 completion state to any human reviewing progress.

## Context

All four round-2 strands (merge-command, diff-repo, terminal-presentation, hardening) are merged into `main` at 33d97c5, which is the base of this worktree's branch. Evidence per item, verified against merged `main`:

- `snap merge <path>` (Concurrent replay and merge section, §7.8, §10): implemented and merged; `tests/16-dot-collision.yaml`, `tests/20-dirty-merge.yaml`, and `tests/26-portability-and-failure-safety.yaml` all pass.
- HTTP repository operand (HTTP section, §9, citing `tests/13-http-client.yaml`): implemented via the §9 client; suite passes.
- `snap merge <url>` (HTTP section, §7.8): implemented; suite passes.
- §7.11 terminal rendering (Terminal presentation section, citing `tests/28-terminal-presentation.yaml`): implemented by the terminal-presentation strand; suite passes.
- Hardening section item "Full `./verify --lang ts` green; `npm run build` clean; `cd test-harness && npm run check && npm test` unchanged": verified on merged main — 32/32 suites pass, build clean, harness checks green.

This is a documentation-only discrepancy in `dev-docs/stacks/snap-1.0.md`. No product code, tests, or `AGENTS.md` files are implicated.

## Out of Scope

- Any edit to product code, `SPEC.md`, `README.md`, tests, or the YAML acceptance suite.
- Any change to `AGENTS.md` files (root or `ts/`).
- Rewording, reordering, or unchecking any existing stack item; touching stack items beyond the five stale ones.
- Stack sections other than the four containing the five stale items.
- Creating new stacks or new stack sections.

## Plan Closeout Notes

<!-- plan-close-review: stack-checkoff -->

- Scope: no drift — implementation matched the plan's Approach and Tasks exactly; no acceptance tests beyond the plan's list were added or modified.
- Documentation impact: none beyond the plan's stated target (dev-docs/stacks/snap-1.0.md, five checkbox flips); verified by git diff.
- Guidelines / conventions: none recorded — no product code, tests, or AGENTS.md files touched.
- Comments / docstrings: conform — no code files touched by this plan.
- Stack items satisfied: snap-1.0 Concurrent replay and merge `snap merge <path>` item; HTTP repository operand item; HTTP `snap merge <url>` item; Terminal presentation §7.11 item; Hardening full-suite item — all five flipped to `- [x]` by this plan's own work (the issue's work is the stack update).

<!-- /plan-close-review -->
