# Dev-Docs Schema

This file defines Janus development artifact types, lifecycle directories, frontmatter, ids, and naming rules.

## Artifact Types

| Type | Location | Purpose |
|---|---|---|
| Research | `dev-docs/research/` | Raw investigation and prior art. Research informs but does not decide. |
| Design | `dev-docs/designs/proposed/` or `approved/` | Intent or realized specifications for system areas, issue steps, or workflow decisions. |
| Issue | the tracker (Linear) or local `dev-docs/issues/backlog/`, `open/`, `closed/` | What needs to be remembered, built, or fixed. No solution detail. Issues are captured in backlog via `/new-issue` (tracker, state shared across worktrees) or `/new-local-issue` (local file, in-repo provenance), then opened via `/open-issue`. |
| Plan | `dev-docs/plans/proposed/`, `approved/`, or `done/` | How an issue or issue step will be resolved. |
| Stack | `dev-docs/stacks/` | Scoped completion checklist for issue creation. Updated by `Update stack` and `Close issue`. |

## Lifecycle State

Lifecycle state is encoded in directory position.
Do not add a `status` frontmatter field.

Examples:

- A proposed plan lives in `dev-docs/plans/proposed/`.
- An approved plan lives in `dev-docs/plans/approved/`.
- A done plan lives in `dev-docs/plans/done/`.

For tracker issues, lifecycle state lives in the tracker (Linear workflow states), not directory position. The tracker operations contract is `dev-docs/harness/tracker.md`. Plans and designs keep directory-position state in git. Local issues in `dev-docs/issues/` encode lifecycle by directory position (backlog, open, closed). id-resolution, id-uniqueness, and issue-existence checks are dual-path (tracker or local) so both stores coexist as peers.

## Frontmatter Schema

Every new or editable Markdown artifact has YAML frontmatter.
Required fields vary by type.

Tracker (Linear) issues are the exception: they carry the janus id in the title prefix (`[<id>] <title>`) and hold the issue body (Problem, Impact, Context, Out of Scope) as the description, with no YAML frontmatter. The frontmatter fields below apply to local file-based issues and to all other artifact types. When a Linear issue comes from a stack, a `**Stack:** <name>` line in the body records the link (the `stack:` frontmatter equivalent).

| Field | Research | Design | Issue | Plan |
|---|---|---|---|---|
| `title` | required | required | required | required |
| `date` | required | required | required | required |
| `start-date` | N/A | N/A | optional, date opened | N/A |
| `author` | required | required | required | required |
| `id` | required, stable research id | required, stable design id | required, stable issue id | required, stable plan id |
| `issue` | N/A | N/A | N/A | required, originating issue id |
| `research` | N/A | N/A | N/A | required if applicable, research ids consulted |
| `designs` | N/A | N/A | N/A | required if applicable, design ids referenced |
| `closed` | N/A | N/A | optional, date closed | N/A |
| `plans` | N/A | N/A | optional, plan ids for new closeouts | N/A |
| `plan` | N/A | N/A | optional, older single plan id | N/A |
| `stack` | N/A | N/A | optional, stack name if issue created from a stack | N/A |
| `completed` | N/A | N/A | N/A | optional, date all tasks completed before immutability |
| `realized_design` | N/A | N/A | N/A | optional, realized design id before immutability |

## Author

For agent-authored documents, use:

```yaml
author: agent
```

## Dates

Use ISO 8601 calendar dates:

```yaml
date: YYYY-MM-DD
```

Opening and closeout dates also use:

```yaml
start-date: YYYY-MM-DD
closed: YYYY-MM-DD
completed: YYYY-MM-DD
```

## Ids

Document ids are durable `kebab-case` identifiers.
They are unique within a document type.

Issue ids are unique across the tracker and the local directories:

- the tracker (Linear), any state
- `dev-docs/issues/backlog/`
- `dev-docs/issues/open/`
- `dev-docs/issues/closed/`

The id does not change when a file moves between lifecycle directories.

## Filenames

Files are named in `kebab-case`.
Normally, the filename stem matches the id.

Examples:

```
dev-docs/issues/open/session-refresh-route.md
dev-docs/plans/proposed/session-refresh-route.md
dev-docs/designs/proposed/session-refresh-route-realized.md
```

Example:

```
dev-docs/issues/closed/session-refresh-route.md
```

## References

Reference fields store stable ids, not lifecycle paths.

Use:

```yaml
issue: session-refresh-route
designs:
  - session-token-model
research:
  - refresh-token-rotation-prior-art
```

Do not use:

```yaml
issue: dev-docs/issues/open/session-refresh-route.md
```

Body prose should prefer stable ids for provenance.
Current paths may be included only as location hints when helpful.

## Older Artifacts

Immutable older artifacts may lack ids, use path-based references, or contain singular issue `plan` metadata.
Do not rewrite immutable artifacts solely for metadata rewrites.
If a mutable artifact needs to reference an older artifact, preserve the older reference form if no stable id exists.

## Frontmatter Fill Rules

Fields left blank at document creation are filled when the lifecycle reaches that step and the file is still editable.
Do not edit approved, done, or closed artifacts just to fill metadata.

## Issue Documents

An issue is a problem container, not a solution document.

New issues are captured in backlog via `/new-issue` (tracker) or `/new-local-issue` (local file `dev-docs/issues/backlog/<id>.md`); the backlog may hold any number of captured issues. `/open-issue <id>` moves a captured issue to open: for a local file, `git mv dev-docs/issues/backlog/<id>.md dev-docs/issues/open/<id>.md` plus a `start-date: YYYY-MM-DD` frontmatter field; for a tracker issue, a `set-state <id> open` move. A tracker issue carries the janus id in its title prefix and holds the body as the description:

```
**Proposed issue id:** `<id>`
**Title:** <title>

## Problem
## Impact
## Context
## Out of Scope
```

Local file-based issues use the frontmatter form:

```yaml
---
title:
date:
author: agent
id:
---
## Problem
## Impact
## Context
## Out of Scope
```

## Plan Documents

A plan describes how an issue or issue step will be resolved.

A plan should normally contain:

```yaml
---
title:
date:
author: agent
id:
issue:
research: []
designs: []
---
## Context
## Current State
## Developer Feedback
## Approach
## Tasks
- [ ] Task one.
## Documentation Impact
## Acceptance Tests
```

A plan must have an originating issue that exists (in the tracker or in local `dev-docs/issues/open/`).

## Design Documents

A design may describe intent or realized implementation.
A realized design written by `Design plan <id>` records the approved plan it realizes.

A realized design should normally contain:

```yaml
---
title:
date:
author: agent
id:
---
## Summary
## Plan Realized
## Implementation
## Behavior
## Tests
## Decisions
## Follow-Up
```

## Research Documents

Research records investigation and prior art.
Research informs plans and designs but does not decide implementation by itself.

## Stack Documents

A stack has frontmatter containing:

```yaml
name:
description:
```

The body contains scoped markdown checklists.
See `dev-docs/harness/stacks.md`.
