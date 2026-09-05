---
title: Delete the four merged Round 2 strand branches with git's safe delete
date: 2026-09-05
author: agent
id: branch-cleanup
issue: branch-cleanup
research: []
designs: []
completed: 2026-09-05
closeout_notes: true
---

## Context

Issue `branch-cleanup` (stack `snap-1.0`) captures the four Round 2 strand branches that are fully merged into `main` at 33d97c5 but still present as refs. This plan executes that housekeeping: delete exactly those four branches with git's safe delete, once the sibling worktree-removal effort unblocks it. No product code, tests, or specifications change; the only repo mutation is the removal of four branch refs in `/Users/therealcisse/code/snap`.

## Current State

- Repository `/Users/therealcisse/code/snap`, `main` at 33d97c5 ("Merge branch 'snap/hardening'").
- Branches present: `main`, `snap/stack-checkoff`, `snap/worktree-cleanup`, `snap/branch-cleanup` (all live at 33d97c5), plus the four dead ones — `snap/merge-command` (2a9603f), `snap/diff-repo` (d78141c), `snap/terminal-presentation` (5fe662d), `snap/hardening` (1e1a544).
- `git branch --no-merged main` is empty: every branch is fully merged into `main`, so all four targets are safe-delete eligible today.
- Worktrees registered under `~/.snap/worktree/` still check out all four dead branches (plus the live strands). `git branch -d` refuses a branch checked out in a registered worktree, so deletion is blocked until the sibling `worktree-cleanup` effort removes those worktrees.

## Developer Feedback

1. **Single plan** (user): four one-line deletions share one acceptance gate; no reason to split.
2. **Safe delete only** (user): `git branch -d`, never `-D`. A refused delete means git judges the branch not merged — STOP and report; forcing would mask exactly the mistake the safe flag guards against.
3. **Exact deletion list pinned** (user): `snap/merge-command`, `snap/diff-repo`, `snap/terminal-presentation`, `snap/hardening`. `main`, `snap/stack-checkoff`, `snap/worktree-cleanup`, and `snap/branch-cleanup` are never deleted.
4. **Hold rule** (user): before any deletion, check `git -C /Users/therealcisse/code/snap worktree list`; if any of the four old worktrees (merge-command, diff-repo, terminal-presentation, hardening under `~/.snap/worktree/`) are still registered, hold deletions and wait for the orchestrator's release, then proceed.
5. **Verification pinned** (user): `git -C /Users/therealcisse/code/snap branch --list 'snap/*'` must show exactly the three live strand branches afterward.
6. Rejected: force delete (`-D`) — masks a not-merged mistake. Rejected: deleting before worktree removal — git refuses a checked-out branch; retrying blindly just fails. Rejected: a generic "delete everything merged into main" pipeline (`git branch --merged main | grep -v ... | xargs git branch -d`) — operates near live branches, harder to review than a pinned four-name list.

## Approach

1. **Re-verify merged state at execution time**: confirm the four branch tips are unchanged (2a9603f, d78141c, 5fe662d, 1e1a544) and `git -C /Users/therealcisse/code/snap branch --no-merged main` is still empty. Any drift means the plan's premise is stale — STOP and report.
2. **Worktree gate**: `git -C /Users/therealcisse/code/snap worktree list`; if any of the four old worktrees remain registered, hold deletions per the dependency rule and wait for the orchestrator's release message before proceeding.
3. **Delete**: one invocation against the shared repo:
   `git -C /Users/therealcisse/code/snap branch -d snap/merge-command snap/diff-repo snap/terminal-presentation snap/hardening`
4. **Verify**: `git -C /Users/therealcisse/code/snap branch --list 'snap/*'` returns exactly `snap/branch-cleanup`, `snap/stack-checkoff`, `snap/worktree-cleanup`; record the outputs.

## Tasks

- [ ] Re-verify merged state in `/Users/therealcisse/code/snap`: four tips unchanged and `branch --no-merged main` empty; any drift → stop and report.
- [ ] Run the worktree gate; if old strand worktrees are still registered, message the orchestrator "holding deletions: waiting for worktree-cleanup" and wait for release.
- [ ] Execute the single safe-delete invocation (`-d` only) for the four pinned branches; a refused delete → stop and report, never `-D`.
- [ ] Post-verification: `branch --list 'snap/*'` shows exactly the three live strand branches; record the command outputs for the realized design.

## Documentation Impact

- No `SPEC.md`, `README.md`, `tests/`, or `AGENTS.md` changes — no product behavior changes.
- The dev-docs lifecycle artifacts for this issue (this plan, its realized design, closeout notes) are the only documentation this plan produces.
- Stack `snap-1.0` is not updated by this plan: no stack checklist item maps to branch housekeeping (recorded at closeout per the stack instruction).

## Acceptance Tests

- `git -C /Users/therealcisse/code/snap branch -d snap/merge-command snap/diff-repo snap/terminal-presentation snap/hardening` reports each branch deleted (safe delete succeeds; no force flag anywhere).
- `git -C /Users/therealcisse/code/snap branch --list 'snap/*'` output is exactly `snap/branch-cleanup`, `snap/stack-checkoff`, `snap/worktree-cleanup`.
- `git -C /Users/therealcisse/code/snap branch -v` lists exactly four branches total: `main` (still at 33d97c5) plus the three live strands.
