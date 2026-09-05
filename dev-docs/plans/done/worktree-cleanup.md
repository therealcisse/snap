---
title: "Decommission merged round-2 worktrees: safe removal of four idle trees"
date: 2026-09-05
author: agent
id: worktree-cleanup
issue: worktree-cleanup
research: []
designs: []
completed: 2026-09-05
closeout_notes: true
---

## Context

Issue `worktree-cleanup`: four merged round-2 worktrees under `~/.snap/worktree/` are idle dead weight in the shared worktree registry. This plan decommissions exactly those four with safe, refuse-on-dirty `git worktree remove`, touching no branches and no repository content. The sibling `branch-cleanup` effort is gated on this plan's completion.

## Current State

- `git -C /Users/therealcisse/code/snap worktree list` (verified 2026-09-05) prints 8 entries: the main checkout `/Users/therealcisse/code/snap` at 33d97c5, plus `~/.snap/worktree/{branch-cleanup,diff-repo,hardening,merge-command,stack-checkoff,terminal-presentation,worktree-cleanup}` at their branch heads.
- All four strand branches are ancestors of main 33d97c5 (`git branch --merged main`): `snap/merge-command` (2a9603f), `snap/diff-repo` (d78141c), `snap/terminal-presentation` (5fe662d), `snap/hardening` (1e1a544).
- Seven `snap/*` branches exist in total; the four strand branches outlive this plan for the `branch-cleanup` issue to delete.
- Worktree removal mutates only the shared worktree registry and the four working directories; no file under version control changes, so no code, test, or acceptance-suite state is at risk.

## Developer Feedback

No interview was held: the issue fixes the operation and its safety envelope as settled constraints, and git offers exactly one safe primitive for it. (Tracker context sync was unavailable — `LINEAR_API_KEY` unset — and unnecessary: the issue is a local file and the registry state is directly observable.) Decisions made in this plan:

- **One plan** (agent): single seam, single acceptance target, like the other stack-derived hygiene work.
- **Plain `git worktree remove` per tree, run from the main checkout** (agent, per issue constraint): git refuses a dirty or locked tree, which is exactly the wanted safety property. Rejected: `--force` in any form (destroys the refuse-on-dirty guard; explicitly forbidden by the issue) and `git worktree prune` alone (clears only stale administrative entries, never live registered trees).
- **Pre-verify cleanliness per tree** (agent, per issue constraint): `git -C <path> status --porcelain` must print nothing before each removal; any output stops the plan for reporting. Belt-and-suspenders in front of git's own guard.
- **Removal order: merge-command, diff-repo, terminal-presentation, hardening** (agent): the issue's enumeration order; the removals are independent, so order carries no semantic dependency.
- **No branch deletion** (user, per issue): all seven `snap/*` branches are untouched; the four strand branches belong to the `branch-cleanup` issue.
- **Post-removal registry assertion** (agent): `git worktree list` must show exactly the enumerated survivor set — main checkout plus `stack-checkoff`, `worktree-cleanup`, `branch-cleanup` — and the branch list must be unchanged.
- **Coordinate immediately after removals succeed** (user, per brief): notify the orchestrator that `branch-cleanup` may proceed, before any closeout work.

## Approach

Step 1 — preflight. Run `scripts/dev-docs-preflight.sh implement-plan worktree-cleanup` (plan exists in approved/, done target clear, originating issue open).

Step 2 — verify and remove, one tree at a time, in order merge-command, diff-repo, terminal-presentation, hardening. For each `<name>`:

```bash
git -C /Users/therealcisse/.snap/worktree/<name> status --porcelain   # must print nothing
git -C /Users/therealcisse/code/snap worktree remove /Users/therealcisse/.snap/worktree/<name>
```

Never pass `--force`. If a status prints anything, or a removal is refused, stop and report; do not continue to the next tree.

Step 3 — assert the end state:

```bash
git -C /Users/therealcisse/code/snap worktree list        # exactly main + stack-checkoff + worktree-cleanup + branch-cleanup
git -C /Users/therealcisse/code/snap branch --list 'snap/*'  # all seven snap/* branches still present
```

Step 4 — notify the orchestrator: "round-2 worktrees removed; branch-cleanup may proceed".

## Tasks

- [ ] Run `git -C /Users/therealcisse/.snap/worktree/<name> status --porcelain` for each of merge-command, diff-repo, terminal-presentation, hardening and confirm empty output.
- [ ] Remove merge-command: `git -C /Users/therealcisse/code/snap worktree remove /Users/therealcisse/.snap/worktree/merge-command`.
- [ ] Remove diff-repo: `git -C /Users/therealcisse/code/snap worktree remove /Users/therealcisse/.snap/worktree/diff-repo`.
- [ ] Remove terminal-presentation: `git -C /Users/therealcisse/code/snap worktree remove /Users/therealcisse/.snap/worktree/terminal-presentation`.
- [ ] Remove hardening: `git -C /Users/therealcisse/code/snap worktree remove /Users/therealcisse/.snap/worktree/hardening`.
- [ ] Verify survivors: `git -C /Users/therealcisse/code/snap worktree list` shows exactly main, stack-checkoff, worktree-cleanup, branch-cleanup; `git branch --list 'snap/*'` still lists all seven snap/* branches.
- [ ] Message the orchestrator that round-2 worktrees are removed and branch-cleanup may proceed.

## Documentation Impact

- None: `SPEC.md`, `README.md`, root and subdirectory `AGENTS.md`, tests, and stack `dev-docs/stacks/snap-1.0.md` are untouched. Worktree removal changes repository hygiene state, not documented behavior. No stack item in `snap-1.0` maps to this work; that is recorded at close-issue, not by editing the stack file.

## Acceptance Tests

- `git -C /Users/therealcisse/code/snap worktree list` prints exactly four entries: `/Users/therealcisse/code/snap`, `~/.snap/worktree/stack-checkoff`, `~/.snap/worktree/worktree-cleanup`, `~/.snap/worktree/branch-cleanup`.
- `ls /Users/therealcisse/.snap/worktree` lists exactly `branch-cleanup`, `stack-checkoff`, `worktree-cleanup` — the four removed trees' directories are gone.
- `git -C /Users/therealcisse/code/snap branch --list 'snap/*'` still lists all seven snap/* branches: no branch deleted.
- `git -C /Users/therealcisse/code/snap status --porcelain` is unchanged by this work; the main checkout's tracked content is untouched.
- `git status --short` inside `/Users/therealcisse/.snap/worktree/worktree-cleanup` shows only the dev-docs lifecycle artifacts of this issue.
