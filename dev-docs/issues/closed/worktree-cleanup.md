---
title: Decommission merged round-2 development worktrees
date: 2026-09-05
start-date: 2026-09-05
author: agent
id: worktree-cleanup
stack: snap-1.0
closed: 2026-09-05
---

## Problem

Round 2 of Snap development left four idle development workspaces registered under `~/.snap/worktree/`, one per finished strand. Their work is fully merged into main at 33d97c5, so the workspaces are dead weight: they clutter `git worktree list`, and nothing uses them.

## Impact

- `git -C /Users/therealcisse/code/snap worktree list` shows eight entries, four of which are finished strands, obscuring the active worktrees and making the registry harder to read at a glance.
- The four directories keep consuming disk under `~/.snap/worktree/` and keep administrative entries in the shared repository's worktree registry.
- Leaving them in place invites mistakes (editing a stale tree) and grows unbounded as rounds accumulate.

## Context

- The four idle worktrees and their merged heads: merge-command (2a9603f, branch `snap/merge-command`), diff-repo (d78141c, `snap/diff-repo`), terminal-presentation (5fe662d, `snap/terminal-presentation`), hardening (1e1a544, `snap/hardening`). All four branches are ancestors of main 33d97c5 (`git branch --merged main` confirms) and all four trees are clean.
- The worktree registry is shared: all worktrees point at the single repository at `/Users/therealcisse/code/snap`; removing a worktree is a registry-level operation runnable from the main checkout.
- Worktrees that must remain untouched: the main checkout `/Users/therealcisse/code/snap`, and the three new round-3 worktrees `stack-checkoff`, `worktree-cleanup`, `branch-cleanup`.
- Settled constraints: removal must be safe — verify each tree is clean before removal and refuse rather than force when git declines; no branch deletion here (the four `snap/*` branches stay for the sibling branch-cleanup effort); the stack file `dev-docs/stacks/snap-1.0.md` is not edited by this issue (no stack item maps to it).

## Out of Scope

- Deleting any git branch (owned by the separate branch-cleanup effort).
- Removing the main checkout or the round-3 worktrees (stack-checkoff, worktree-cleanup, branch-cleanup).
- Any change to product code, tests, `SPEC.md`, or stack `snap-1.0`.
- History rewriting, pruning remote state, or any repository-content change.

## Plan Closeout Notes

<!-- plan-close-review: worktree-cleanup -->

- Scope: no drift — all seven tasks landed as written: per-tree cleanliness verification, the four removals in order, the survivor and branch assertions, and the coordination notification.
- Documentation impact: none — `SPEC.md`, `README.md`, `AGENTS.md` files, tests, and stack `snap-1.0.md` are untouched, matching the plan's "none".
- Guidelines / conventions: none recorded — no GUIDELINES files exist in this repo and no code was touched.
- Comments / docstrings: conform — no code files were created or modified.
- Stack items satisfied: none — worktree removal satisfies no item in `snap-1.0`; the stack file is deliberately unchanged and the no-mapping note is recorded at close-issue.

<!-- /plan-close-review -->

## Closeout

Closeout: 2026-09-05. The four round-2 worktrees (merge-command, diff-repo, terminal-presentation, hardening) are removed; the registry lists exactly the main checkout plus the three round-3 worktrees; no branch or tracked file changed. Doc review: no changes needed — AGENTS.md, README.md, and ts/AGENTS.md document behavior and navigation, not transient worktree hygiene (excluded by the AGENTS.md change policy), and no GUIDELINES files exist. Stack `snap-1.0`: no stack items map to this issue — the removal satisfies no checklist item, so `dev-docs/stacks/snap-1.0.md` is deliberately unchanged.

Human-gated close (agent does not run):

```bash
mv dev-docs/issues/open/worktree-cleanup.md dev-docs/issues/closed/worktree-cleanup.md
```
