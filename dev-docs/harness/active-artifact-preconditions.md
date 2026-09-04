# Active Artifact Preconditions

This file defines the active-work gate used by lifecycle commands.

## Purpose

The active-artifact gate prevents agents from opening multiple conflicting workflow threads at once.
It protects review order and keeps the lifecycle legible.

## Active Artifact Directories

The following directories contain active work:

- `dev-docs/designs/proposed/`
- `dev-docs/plans/proposed/`
- `dev-docs/plans/approved/`

## Ignored Example Documents

Active-artifact checks ignore example documents.
Ignore a document if either condition is true:

- Its frontmatter has `id: example`.
- Its filename stem is `example`.

## Commands That Require the Gate

These commands require active-artifact preconditions to pass:

- `/plan-issue <id>`

## Commands That Do Not Require the Gate

These commands do not require the gate:

- `/new-issue` and `/new-local-issue` (id-uniqueness check only; a captured issue is not an active workflow thread)
- `/open-issue <id>` (state checks only; opening a captured issue is not an active workflow thread)
- `Approve plan <id>`
- `/implement-plan <id>`
- `/design-implementation <id>`
- `Approve design <id>`
- `/close-plan <id>`
- `/close-issue <id>`
- `Create stack <description>`
- `Update stack <name>`

Some of these commands have their own different preconditions.

## Check Procedure

Run the canonical verification script:

```
scripts/dev-docs-preflight.sh plan-issue <id>
```

This runs the active-artifact check as part of the full preflight. The check:

1. Lists non-example `.md` files in `dev-docs/designs/proposed/`.
2. Lists non-example `.md` files in `dev-docs/plans/proposed/`.
3. Lists non-example `.md` files in `dev-docs/plans/approved/`.
4. Passes if no active work exists.
5. Fails and prints the active file list if active work exists.

## Failure Behavior

If the gate fails, stop.
Do not create a new plan.
Do not move or modify the active artifacts.

Report the active artifacts and recommend the next appropriate command.

Example response:

```
Active artifact preconditions failed.
Active work exists:
- dev-docs/plans/proposed/session-refresh-route.md
Finish or resolve active work before planning another.
Likely next command:
Approve plan session-refresh-route
```

## Rationale

`/plan-issue` opens a new workflow branch; capturing and opening a problem do not. Issue creation is gated on id uniqueness; `/open-issue` moves an already-captured issue.
If proposed designs, proposed plans, or approved plans already exist, the agent should finish, approve, implement, design, or close that work before planning another.
