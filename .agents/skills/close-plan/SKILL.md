# Close Plan

Moves an approved plan to done after verifying implementation is complete. Executes the move directly.

<HARD-GATE>
Do NOT edit the approved plan. Do not close the issue. Do not create commits.
</HARD-GATE>

## Operational Directives

### Allowed Writes

- `dev-docs/plans/done/<id>.md` (the move target, created by this skill).
- Record plan closeout notes on the parent issue: append to `dev-docs/issues/open/<issue-id>.md` (local issue), or post as a Linear comment via `scripts/linear.sh comment <issue-id>` (tracker issue).

### Forbidden Writes

- Product code.
- Tests.
- `dev-docs/plans/approved/<id>.md`
- `dev-docs/plans/done/`, except the move target created by this skill.
- `dev-docs/issues/closed/`
- `dev-docs/designs/approved/`
- Root `AGENTS.md`, unless explicitly requested and justified.
- Subdirectory `AGENTS.md` files, unless explicitly requested and justified.

## Checklist

1. **Resolve plan id** -- use the given id or infer from context
2. **Verify preconditions** -- run preflight, confirm implementation is complete
3. **Plan closeout review** -- scope verification (advisory), documentation impact, guidelines/conventions drift, comment and docstring conformance, stack impact, record notes to parent issue
4. **Execute the move** -- approved/ to done/

## Step 1. Resolve Plan Id

If the user provided a plan id, use it.

If no id was provided:
- List non-example `.md` files in `dev-docs/plans/approved/`.
- If exactly one exists, use it.
- If zero or multiple exist, report and ask for the plan id.

The plan must exist in `dev-docs/plans/approved/`.

## Step 2. Verify Preconditions

Read these files (skip if already in context):

- `AGENTS.md`
- `dev-docs/plans/approved/<plan-id>.md`
- `dev-docs/harness/tracker.md`
- `.agents/skills/linear/SKILL.md`
- The parent issue: the local file `dev-docs/issues/open/<issue-id>.md`, or `scripts/linear.sh fetch <issue-id>` for a tracker issue.

Run `scripts/dev-docs-preflight.sh close-plan <id>`. If the gate fails, stop and report.

Verify (manual checks, ask the user if unclear):
- Implementation for the plan appears complete.
- Acceptance checks have passed or have been supplied by the developer.
- Required realized designs are approved, or the plan clearly records that no realized design is required.

## Step 3. Plan Closeout Review

Perform a lightweight, plan-scoped review before the plan becomes immutable. Record findings to the parent issue (still mutable) for later use at close-issue. This review does not edit AGENTS.md, README, or GUIDELINES.

### 3.1 Scope Verification (Advisory + Confirmation)

Read the approved plan and compare against the implemented work:

- Did the implementation stay within the plan's stated `## Approach` and `## Tasks`?
- Were any acceptance tests added or modified that were not listed in `## Acceptance Tests`?
- Were any tasks marked complete that were not actually implemented?

If scope drift is detected:
- Report the specific differences to the user.
- Ask: `Scope drift detected. Proceed with plan close anyway? (y/n)`
- Only proceed if the user confirms.

If no drift, continue silently.

### 3.2 Documentation Impact Check

Read the plan's `## Documentation Impact` section.

If empty or absent:
- Ask: "Did this plan introduce any new patterns, conventions, or module boundaries that might warrant later documentation?"
- If the answer is yes, record a one-sentence observation (see 3.6).

If content already exists:
- Verify it matches what was implemented.
- Note any additional impact discovered.

### 3.3 Guidelines and Conventions Drift Check

Check whether the implementation introduced or relied on patterns that diverge from or extend:

- `GUIDELINES.md` (root and relevant service `GUIDELINES.md`)
- `scala-conventions.md`

Look for:
- New controller/repository/effect patterns not covered by existing recipes
- New Cats Effect or Cats idioms used in production code
- New DynamoDB or persistence access shapes
- New error handling or logging conventions

If any drift or extension is found, record a one-sentence observation (see 3.6). Do not edit the guidelines files here.

### 3.4 Comment and Docstring Conformance (Advisory)

Review comments and docstrings on functions, types, modules, and classes added
or modified by this plan, against the comment and docstring directives already
in effect from the active agent rules. Do not restate the rules here.

- Scope: only files touched by this plan; only new or modified comments.
- Flag clear violations only; judgment-call phrasing is not a violation.
- Record each finding as one line: `file:line`, the offending phrase, and a
  proposed replacement. Do not edit code comments here; proposals are applied
  later by the developer or a follow-up plan.

### 3.5 Stack Impact (if applicable)

If the parent issue names a stack (local `stack:` frontmatter, or the `**Stack:** <name>` line in a Linear issue body):

- Read `dev-docs/stacks/<name>.md`
- Identify which checklist items this plan's work satisfies
- Record those item references so close-issue can check them off without re-analysis

### 3.6 Record Closeout Notes to Parent Issue

Record a tagged block on the parent issue (not the plan). For a local issue, append the block to `dev-docs/issues/open/<issue-id>.md`. For a tracker (Linear) issue, pipe the block to `scripts/linear.sh comment <issue-id>`. Use a consistent marker so close-issue can find all plan closeout notes later:

```markdown
## Plan Closeout Notes

<!-- plan-close-review: <plan-id> -->

- Scope: <one-line summary or "no drift">
- Documentation impact: <one-sentence observation or "none recorded">
- Guidelines / conventions: <one-sentence observation or "none recorded">
- Comments / docstrings: <violations as `file:line`, offending phrase, proposed replacement, or "conform">
- Stack items satisfied: <list or "none">

<!-- /plan-close-review -->
```

If multiple plans close for the same issue, each appends its own tagged block. The issue remains the running log.

Also update the plan frontmatter before the move:

```yaml
completed: YYYY-MM-DD
closeout_notes: true
```

The `closeout_notes: true` flag on the done plan tells close-issue to scan the parent issue for these blocks.

## Step 4. Execute the Move

Run:

```bash
mv dev-docs/plans/approved/<id>.md dev-docs/plans/done/<id>.md
```

Report:

```
Plan close checks passed.
Moved dev-docs/plans/approved/<id>.md -> dev-docs/plans/done/<id>.md
```

If other plans remain for this issue:
```
Next skill:
/plan-issue <issue-id>
```

If all plans are closed and the user considers the work done:
```
Next skill:
/close-issue <issue-id>
```

Otherwise, do not suggest a next skill.

## Stop Condition

Stop after executing the move.
Do not edit the approved plan.
Do not close the issue.
Do not create commits.

## Key Principles

- **Approved plans only** -- the plan must exist in `dev-docs/plans/approved/`.
- **Verify before moving** -- confirm implementation is actually complete and acceptance checks passed.
- **Plan closeout review** -- scope verification (advisory with confirmation), documentation impact, guidelines drift, comment and docstring conformance (advisory, no code edits), and stack impact are recorded to the parent issue before immutability; no AGENTS.md edits.
- **Execute the move** -- run the `mv` directly, do not print it for the user to run.
- **Project-agnostic** -- this skill references only root `AGENTS.md` and files under `dev-docs/`.
