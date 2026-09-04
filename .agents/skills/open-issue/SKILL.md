# Open Issue

Moves a captured backlog issue to open. Capture happens in `/new-issue` (tracker) or `/new-local-issue` (local file); this skill is the explicit open commitment. It stamps `start-date` (local files) and executes the backlog-to-open move in whichever store holds the issue. No interview, no drafting: the issue content is already complete from capture.

Dual-path store detection: local `dev-docs/issues/backlog/<id>.md` first, then the tracker. See `dev-docs/harness/tracker.md` for the two-store model.

## Operational Directives

### Allowed Writes

- `git mv dev-docs/issues/backlog/<id>.md dev-docs/issues/open/<id>.md` (local store).
- Adding `start-date: <YYYY-MM-DD>` to the frontmatter of that one file.
- `scripts/linear.sh set-state <id> open` (tracker store).

### Forbidden Writes

- Everything else: product code, tests, `dev-docs/plans/`, `dev-docs/designs/`, `dev-docs/stacks/`, root `AGENTS.md`, subdirectory `AGENTS.md` files, and every other issue file.
- Editing the issue body: opening is a state move, not a revision.

## Checklist

Complete these steps in order:

1. **Gather context** -- read required harness files
2. **Determine the store** -- local backlog file or tracker
3. **Preflight** -- run the open-issue gate
4. **Open** -- execute the move and stamp `start-date`
5. **Report** -- state the new location and the stamped date

## Step 1. Gather Context

Read these files (skip if already in context):

- `AGENTS.md`
- `dev-docs/harness/README.md`
- `dev-docs/harness/dev-docs-schema.md`
- `dev-docs/harness/tracker.md`

## Step 2. Determine the Store

- Local store: `dev-docs/issues/backlog/<id>.md` exists.
- Tracker store: otherwise resolve via `scripts/linear.sh find-by-id <id>` (the issue must be in the backlog state).

## Step 3. Preflight

Run `scripts/dev-docs-preflight.sh open-issue <id>`. If any check fails, stop and report the failure and the remedying command.

## Step 4. Open

- Local store: `git mv dev-docs/issues/backlog/<id>.md dev-docs/issues/open/<id>.md`, then add `start-date: <YYYY-MM-DD>` (today) to the frontmatter.
- Tracker store: `scripts/linear.sh set-state <id> open`.

## Step 5. Report

Report the new location (path or tracker state) and, for local files, the stamped `start-date`.

## Stop Condition

Stop immediately after opening the issue.
Do not create a plan.
Do not create a design.
Do not edit the issue body.
Do not edit product code.
Do not edit tests.
Do not approve anything.

The next skill is `/plan-issue <id>`, which is still gated by the active-artifact preconditions.

## Expected Response

Local file:

```
Opened <id>: dev-docs/issues/open/<id>.md (start-date: <YYYY-MM-DD>)
Next skill (when ready):
/plan-issue <id>
```

Tracker issue:

```
Opened <id> in the tracker: state open
Next skill (when ready):
/plan-issue <id>
```

## Key Principles

- **Explicit open** -- capture and open are separate commitments; the backlog may hold many captured issues, and opening marks the explicit acceptance of one.
- **No revision** -- the issue body is frozen at capture; open is a state move only.
- **Respect the harness** -- preflight, lifecycle rules, and the tracker operations contract from `dev-docs/harness/` apply.
- **Project-agnostic** -- this skill references only root `AGENTS.md` and files under `dev-docs/` and `.agents/`.
