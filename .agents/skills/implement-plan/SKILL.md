# Implement Plan (Interactive)

Executes an approved plan through task-by-task implementation. Adapts the executing-plans and subagent-driven-development patterns for the dev-docs harness.

<HARD-GATE>
Do NOT commit any changes. Do not modify approved, done, or closed artifacts. Do not create plans, designs, or issues during implementation. Only execute plans from `dev-docs/plans/approved/`.
</HARD-GATE>

## Operational Directives

### Allowed Writes

Allowed writes are determined by the approved plan. They may include:

- Product code.
- Tests.
- Documentation explicitly required by the approved plan.
- Generated or schema files explicitly required by the approved plan.

### Forbidden Writes

- `dev-docs/plans/approved/<id>.md`
- `dev-docs/plans/done/`
- `dev-docs/issues/closed/`
- `dev-docs/designs/approved/`
- New plans, unless the user explicitly stops implementation and requests replanning.
- New issues, unless implementation reveals an unrelated problem and the user explicitly asks to capture it.
- Root `AGENTS.md`, unless explicitly requested and justified.
- Subdirectory `AGENTS.md` files, unless explicitly requested and justified.

## Checklist

Complete these steps in order:

1. **Resolve plan id** -- use the given id or infer from context
2. **Gather context** -- read harness files, the plan, the issue, specs, code
3. **Confirm execution mode** -- inline or subagent-driven
4. **Execute tasks** -- implement each task, verify, track progress
5. **Run acceptance checks** -- validate the plan's acceptance tests
6. **Report** -- summarize what was done and what is next

## Step 1. Resolve Plan Id

If the user provided a plan id, use it.

If no id was provided:
- List non-example `.md` files in `dev-docs/plans/approved/`.
- If exactly one exists, use it.
- If zero or multiple exist, report and ask for the plan id.

The plan must exist in `dev-docs/plans/approved/`. Do not execute plans from `proposed/` or `done/`.

## Step 2. Gather Context

Read these files (skip if already in context):

- `AGENTS.md`
- `dev-docs/harness/README.md`
- `dev-docs/harness/dev-docs-schema.md`
- `dev-docs/plans/approved/<plan-id>.md`
- The originating issue: the local file `dev-docs/issues/open/<issue-id>.md`, or `scripts/linear.sh fetch <issue-id>` for a tracker issue.

The issue id is read from the plan's frontmatter `issue` field. This id is used when suggesting next skills.

Then investigate the codebase based on what the plan covers. Use the root `AGENTS.md` and sub-`AGENTS.md` files as the map to find relevant source, tests, config, and schemas:

- Relevant service directories identified by the repository map in `AGENTS.md`.
- Relevant sub-`AGENTS.md` and `GUIDELINES.md` files for the affected services.
- Relevant specs, completed plans, and approved designs.

Run `scripts/dev-docs-preflight.sh implement-plan <id>` to verify preconditions. If the gate fails, stop and report.

## Step 3. Confirm Execution Mode

Ask the user:

> How should this plan be executed?
> - **Inline** -- execute tasks one by one in this session, with review checkpoints
> - **Subagent-driven** -- dispatch a fresh subagent per task, with spec compliance and code quality reviews after each

If the platform does not support subagents, recommend inline execution.

Present any concerns about the plan before starting (missing tasks, unclear instructions, scope issues). Ask whether to proceed or revise.

## Step 4. Execute Tasks

Extract all tasks from the plan. Create a todo list to track progress.

### Inline execution

For each task:

1. Mark the task as in progress.
2. Read the task details. Gather any additional context needed.
3. Implement the task. Follow the plan's instructions exactly.
4. Run any verification commands specified in the task (compile, test, lint).
5. If verification fails, fix and re-run. If the plan is wrong, apply the drift response (see Execution rules): follow, record a refinable deviation, or stop and replan.
6. Mark the task as done.

Do not stop between tasks to ask permission to continue. Execute all tasks unless blocked. If blocked, report the blocker immediately and ask for guidance.

### Subagent-driven execution

For each task:

1. Extract the full task text and relevant context (file paths, specs, patterns).
2. Dispatch a subagent with complete instructions. The subagent receives only what it needs, not the full plan or session history.
3. Wait for the subagent to complete.
4. If the subagent reports DONE: dispatch a spec compliance review, then a code quality review.
5. If reviews find issues: have the subagent fix them, then re-review.
6. If the subagent reports BLOCKED: assess the blocker. Provide more context, re-dispatch with a more capable model, or break the task into smaller pieces.
7. Mark the task as done.

Do not dispatch multiple implementation subagents in parallel (file conflicts). Execute sequentially.

### Execution rules (both modes)

- **No commits.** Implement but do not commit. The user decides when to commit.
- **Drift response.** When the plan and the work diverge, apply exactly one of these:
  - **Follow** -- the plan is clear; implement it exactly. No entry.
  - **Record a refinable deviation** -- the work makes a justified, in-scope refinement of the plan's letter (an extra or changed file, an alternate correct approach, a side-effect that resolves an issue Open Question) without changing the plan's intent and without breaking an acceptance test. Proceed, AND append a one-line entry to a running deviation list: what changed and why. This keeps drift visible instead of silent.
  - **Stop and replan** -- the divergence changes the plan's intent or breaks an acceptance test. Stop, report the mismatch, and request replanning.
- **Comment and docstring directives.** Comments and docstrings written during implementation must follow the comment and docstring directives already in effect from the active agent rules.
- **Do not skip verifications.** If the plan says to run tests, run them.
- **Report unrelated findings.** If implementation reveals follow-up work outside the plan, note it but do not act on it (out-of-scope is not a deviation).
- **Respect the harness.** Do not modify plans, designs, issues, or AGENTS.md during implementation unless the plan explicitly requires it.

## Step 5. Run Acceptance Checks

After all tasks are complete, run the plan's acceptance tests. For each test:

- If it can be run automatically, run it and record the result.
- If it requires manual inspection, note what was verified and how.

Report results as:
- **Passed**: list of passing checks.
- **Not run**: list of checks that could not be verified, with reasons.

## Step 6. Report

```
Implemented `<plan-id>`.
Tasks completed: N/N
Acceptance checks:
- Passed:
  - <check>
- Not run:
  - <check> (<reason>)
Deviations:
- <one-line deviation recorded during execution, or "none">
Uncommitted changes: <list of changed files>
Next skill:
/design-implementation <issue-id>
```

## Stop Condition

Stop after implementation and acceptance checks.
Do not commit changes.
Do not modify the plan file.
Do not move the plan.
Do not create a realized design.
Do not close the issue.

## Key Principles

- **No commits** -- the user decides when and what to commit.
- **Approved plans only** -- the plan must exist in `dev-docs/plans/approved/`.
- **Plan is the contract** -- implement what the plan says. If it is wrong, stop and report.
- **No scope expansion** -- do not add tasks, fix unrelated code, or improve adjacent code.
- **Verify everything** -- run the plan's acceptance tests. Do not skip verifications.
- **Report blockers immediately** -- do not guess or force through problems.
- **Project-agnostic** -- this skill references only root `AGENTS.md` and files under `dev-docs/`. Project-specific specs, source directories, and service structure live in the repo's own `AGENTS.md` and sub-`AGENTS.md` files, not in this skill.
