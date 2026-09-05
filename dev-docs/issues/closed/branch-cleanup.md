---
title: Delete the four merged Round 2 strand branches
date: 2026-09-05
start-date: 2026-09-05
author: agent
id: branch-cleanup
stack: snap-1.0
closed: 2026-09-05
---

## Problem

Four development branches whose work is already fully incorporated into the main line are still listed as if they were active. Anyone listing the repository's branches sees finished work sitting next to the branches actually in flight, and nothing distinguishes the dead entries from the live ones.

Round 2's four strand branches — `snap/merge-command` (2a9603f), `snap/diff-repo` (d78141c), `snap/terminal-presentation` (5fe662d), and `snap/hardening` (1e1a544) — are all fully merged into `main` at 33d97c5 (`git branch --no-merged main` is empty), but the refs still exist in the repository. The hygiene move is to remove them with git's safe delete so `git branch` lists only live work.

## Impact

- `git branch` output carries four dead entries alongside the live strand branches (`snap/stack-checkoff`, `snap/worktree-cleanup`, `snap/branch-cleanup`), inviting confusion between finished and in-flight work.
- Each future strand that lands without cleanup compounds the clutter and raises the risk of accidentally continuing work on a stale, already-merged branch.
- No product behavior or test suite is affected; this is repository housekeeping.

## Context

- Repository: `/Users/therealcisse/code/snap`, `main` at 33d97c5 ("Merge branch 'snap/hardening'").
- The four branches to remove, with their tips: `snap/merge-command` (2a9603f), `snap/diff-repo` (d78141c), `snap/terminal-presentation` (5fe662d), `snap/hardening` (1e1a544).
- Settled constraint: deletion uses git's safe delete only (`git branch -d`). A refused delete means git judges the branch not merged — that must stop the work and be reported, never forced with `-D`.
- Settled constraint: `main`, `snap/stack-checkoff`, `snap/worktree-cleanup`, and `snap/branch-cleanup` must never be deleted.
- Dependency: `git branch -d` refuses while a branch is checked out in a live worktree. The four strand worktrees under `~/.snap/worktree/` are being removed by a sibling effort (worktree-cleanup), so branch deletion must wait until those worktrees are gone.
- Stack link: recorded against stack `snap-1.0`; this is repository housekeeping and maps to no stack checklist item.

## Out of Scope

- Removing the strand worktrees under `~/.snap/worktree/` (owned by the sibling worktree-cleanup effort).
- Deleting any branch other than the four listed, and any use of force delete (`-D`).
- Remote branch management or push (the repository has no remote branch workflow).
- Any change to product code, tests, or specifications beyond the dev-docs lifecycle artifacts for this issue.
- Implementation approach and task breakdown — decided by the plan, not this issue.

## Plan Closeout Notes

<!-- plan-close-review: branch-cleanup -->

- Scope: no drift — all four tasks executed as written (merged-state gates re-verified at execution time; hold rule fired per the worktree dependency and released by the orchestrator; one safe-delete invocation; post-verification recorded in the realized design); acceptance checks 3/3 passed.
- Documentation impact: none beyond the plan's own record — no `SPEC.md`, `README.md`, `tests/`, or `AGENTS.md` changes; only this issue's lifecycle artifacts.
- Guidelines / conventions: none recorded (no product code touched; repo has no GUIDELINES files).
- Comments / docstrings: conform (no code files touched).
- Stack items satisfied: none — branch housekeeping maps to no `snap-1.0` checklist item; the stack file is not edited for this issue.

<!-- /plan-close-review -->
