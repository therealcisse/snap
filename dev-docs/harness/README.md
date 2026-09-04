# Janus Harness

This directory contains detailed agent workflow protocol for Janus.
The root `AGENTS.md` is the stable map. This directory is the detailed harness.

## Purpose

The harness exists to keep agent work legible, reviewable, and incremental.
It prevents these failure modes:

- Creating an issue and implementing it in the same step.
- Writing a plan after implementation.
- Treating approved, done, or closed artifacts as editable.
- Updating root `AGENTS.md` for fast-changing feature state.
- Mixing issue, plan, design, implementation, and closeout responsibilities.
- Losing human review gates.

## Core Model

Janus development artifacts live in `dev-docs/`.
The main artifact types are:

- **Research**: investigation and prior art.
- **Design**: intent or realized system design.
- **Issue**: problem container, not a solution document.
- **Plan**: implementation approach for one issue or one issue step.
- **Stack**: scoped completion checklist derived from spec or implementation gaps.

Lifecycle state is encoded by directory position for plans and designs:

- `dev-docs/plans/proposed/`, `approved/`, `done/`
- `dev-docs/designs/proposed/`, `approved/`

Issues may live in the tracker (Linear), where lifecycle state is a workflow state (Backlog, Todo, Done, Canceled), not a directory, or as local files in `dev-docs/issues/`, where lifecycle state is the directory (backlog, open, closed). The tracker operations contract is `dev-docs/harness/tracker.md`; the Linear backend is `scripts/linear.sh` (see `.agents/skills/linear/SKILL.md`). id-resolution and issue-existence checks are dual-path (tracker or local) so both stores coexist as peers.

There is no `status` frontmatter field.

## Human Gates

Agents can create and edit mutable artifacts.
Agents execute lifecycle moves after passing precondition checks for `approve plan`, `approve design`, and `close plan`.

Humans gate only the final move into a closed issue:

- Local file issue: the move into `dev-docs/issues/closed/`. The agent prints the exact `mv` command; it does not run it.
- Tracker (Linear) issue: the move to Done. The agent prints the issue's tracker deep-link; it never sets Done itself.

In both cases the agent records closeout notes first (frontmatter for a local issue, a tracker comment for Linear) and hands the human the gated final move.

## Immutable Artifacts

These directories are immutable:

- `dev-docs/designs/approved/`
- `dev-docs/plans/approved/`
- `dev-docs/plans/done/`
- `dev-docs/issues/closed/`

The agent must not edit files in these directories.
If immutable artifacts contain old metadata, path-based references, singular `plan` fields, or missing ids, leave them alone unless the user explicitly asks for a metadata rewrite.

## Lifecycle Summary

1. Capture an issue in backlog with `/new-issue` (tracker) or `/new-local-issue` (local file).
2. Run `/open-issue <id>` to move the captured issue to open and stamp `start-date`.
3. Create research if needed.
4. Run `/plan-issue <id>` to write the next implementation plan (in-chat review, writes straight to approved).
5. Run `/implement-plan <id>`.
6. If implementation proves the plan is wrong for its intended scope, stop and revise through the workflow.
7. After implementation and acceptance checks, run `/design-implementation <id>` to write the realized design (in-chat review, writes straight to approved).
8. Run `/close-plan <id>` to move the plan to `dev-docs/plans/done/`.
9. If work remains, run `/plan-issue <id>` again for the next step.
10. When no work remains, run `/close-issue <id>` to record closeout notes and hand off the human-gated close (file move for local issues, Done in the tracker for Linear issues).

## File Index

| File | Purpose |
|---|---|
| `README.md` | This file. Workflow overview and lifecycle summary. |
| `dev-docs-schema.md` | Document types, frontmatter schema, ids, filenames, and naming rules. |
| `tracker.md` | Tracker operations contract: the stable surface every issue-tracker backend implements, plus the live-not-cached and dual-path rules. |
| `active-artifact-preconditions.md` | Active-work gate used by `Plan issue`. |
| `agents-policy.md` | When and how to edit `AGENTS.md` files. Destination rules. Bloat checks. |
| `stacks.md` | Stack model, create/update procedures, and close-issue interaction. |
| `commands/README.md` | Command protocol overview and shared rules. |
| `commands/*.md` | One file per surviving command-driven stage (stack, approve plan, approve design). |

## Verification Scripts

Mechanical precondition checks live in `scripts/`:

- `scripts/dev-docs-preflight.sh <command> [id]` — single precondition gate for all lifecycle commands. Run before every command.

## General Rules

- Do not collapse lifecycle stages.
- Do not create plans without an originating issue (tracker or local open).
- Do not implement from a proposed plan.
- Do not edit approved, done, or closed artifacts.
- Do not move artifacts into the closed directory. Moves into open are executed by `/open-issue`, and moves into approved and done by `approve plan`, `approve design`, and `close plan`, after precondition checks pass.
- Do not create story implementation commits unless explicitly asked.
- Do not create closeout metadata-only commits unless explicitly asked.
- Use stable ids for references.
- Prefer repository-local context over memory.
- Keep root `AGENTS.md` short and stable.
