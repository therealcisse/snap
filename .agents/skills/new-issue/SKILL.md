# New Issue (Interactive)

Captures an issue in backlog in the tracker (Linear) through guided, interactive questioning. New issues are created in Linear, not as repo files, so their state is shared across worktrees. Opening the captured issue is a separate step (`/open-issue`). See `.agents/skills/linear/SKILL.md` and `dev-docs/harness/tracker.md`.

Adapts the brainstorming one-question-at-a-time approach to produce a well-structured problem container. The result is an issue in the tracker, not a solution.

<HARD-GATE>
Do NOT create the tracker issue until you have completed the interview and the user has approved the draft. Do NOT propose solutions, plans, designs, implementation tasks, or code changes. The output is a problem container.
</HARD-GATE>

## Operational Directives

### Allowed Actions

- Create the issue in the tracker via `scripts/linear.sh create-issue <id> <title>` (description on stdin).
- Read `dev-docs/stacks/<name>.md` when the issue comes from a stack.

### Forbidden Writes

- Product code.
- Tests.
- `dev-docs/issues/` (the local store; this skill creates tracker issues, not local files).
- `dev-docs/plans/`.
- `dev-docs/designs/`.
- `dev-docs/stacks/` (read only).
- Root `AGENTS.md`, unless explicitly requested and justified.
- Subdirectory `AGENTS.md` files, unless explicitly requested and justified.

## Checklist

Complete these steps in order:

1. **Gather context** -- read required harness files, check preconditions
2. **Determine source** -- stack-driven or freestanding
3. **Interview** -- ask clarifying questions one at a time
4. **Draft** -- present the issue for user review
5. **Create** -- create the tracker issue and report the url

## Step 1. Gather Context

Read these files (skip if already in context):

- `AGENTS.md`
- `dev-docs/harness/README.md`
- `dev-docs/harness/dev-docs-schema.md`
- `dev-docs/harness/active-artifact-preconditions.md`
- `dev-docs/harness/tracker.md`
- `.agents/skills/linear/SKILL.md`

## Step 2. Determine Source

Ask the user:

> Is this issue derived from a stack, or freestanding?

If from a stack:
- Read `dev-docs/stacks/<stack>.md`.
- Identify the next unchecked item or related item group.
- Use that as seed context for the interview; skip questions the stack already answers.

If freestanding:
- Use whatever the user has already said as seed context.

## Step 3. Interview

Ask questions **one at a time**. Prefer multiple-choice when possible. Open-ended is fine when the answer space is too broad for options.

Adapt the sequence based on answers. Skip questions the user has already answered. Stop when you have enough to write all four sections (Problem, Impact, Context, Out of Scope).

### Question sequence

The sequence below is a guide, not a rigid script. Reorder, merge, or skip questions based on what is already known. The goal is to fill every section with concrete, specific content.

**Problem discovery (fills ## Problem)**

1. **What is the problem in one sentence?**
   Get the core issue stated plainly, in non-technical terms anyone on the team could understand. This becomes the lead sentence of ## Problem.

2. **What is broken, missing, or wrong today?**
   Observable symptoms. What does a user or developer see (or fail to see)?

3. **Is this a bug, a missing capability, a structural/design issue, or a gap between spec and implementation?**
   Multiple choice. Frames the problem type.

**Impact discovery (fills ## Impact)**

4. **Who or what is affected?**
   Users, developers, other services, tests, deployment, observability, etc.

5. **What happens if this is not fixed?**
   Concrete consequences: broken flows, blocked features, security exposure, data issues, etc.

**Context discovery (fills ## Context)**

6. **Where in the codebase does this live?**
   Services, modules, files, config, tables, endpoints. Be specific.

7. **What already exists that is relevant?**
   Related code, patterns, prior decisions, specs, existing partial implementations.

8. **Are there constraints or dependencies to be aware of?**
   Schema shape, API compatibility, concurrency, ordering, external systems, performance, etc.

9. **Any settled constraints worth recording?**
   Settled facts that bound the solution space: a decision the user has already made ("routing is identity-only"), or something an existing spec/schema fixes ("RS256 signing keys are per-tenant"). Record these. Open design questions (which approach, which library) do NOT go in the issue; they belong in the plan. Ask only if the earlier questions left gaps.

**Boundary discovery (fills ## Out of Scope)**

10. **What should explicitly NOT be part of this issue?**
    Related work, future improvements, adjacent concerns that should be split into separate issues. You may survey the solution space enough to draw these in/out lines (what is adjacent, what is a separate workstream), but not to choose an approach. Drawing the boundary is allowed; committing to a design is not.

### Interview rules

- One question per message.
- If the user's answer covers multiple upcoming questions, skip them.
- If an answer is vague, follow up once for specifics before moving on.
- Never ask more than 10 questions total. If you have enough after 4-5, stop.
- Summarize your understanding after the last question before proceeding to the draft.
- Landscape, not design: a settled constraint (the user has decided it, or an existing spec/schema fixes it) belongs in the issue; an open choice among viable options belongs in the plan. When unsure, put it in the plan and let plan-issue confirm.

## Step 4. Draft

Present the complete issue in the chat for review. The body becomes the Linear issue description; the janus id is carried in the issue title prefix by the backend. Use this structure:

```
**Proposed issue id:** `<kebab-case-id>`
**Title:** <title>

## Problem

<First paragraph: plain-language description of the problem. Non-technical.
Anyone on the team should be able to read this paragraph and understand
what is wrong, missing, or broken without knowing the codebase.>

<Second paragraph onward: technical description. Specific services, modules,
files, code paths, data structures, wire formats, error codes, config keys.
Concrete enough to orient a reader who is not in this conversation, but does
not pre-solve the plan. The plan author re-investigates and decides.>

## Impact

<Concrete consequences. Who/what is affected and how.>

## Context

<What exists and where: services, modules, files, tables, endpoints, specs,
prior decisions, and the hard constraints (schema, protocol, ordering, external
systems, performance) that bound the solution space. The space the solution
lives in, not the solution. Open design choices do not go here; they belong in
the plan.>

## Out of Scope

<Bullet list of explicitly excluded concerns.>
```

When the issue comes from a stack, prepend a `**Stack:** <name>` line to the body so the link is visible in Linear.

Ask:

> Does this look right? Any changes before I create the issue?

Iterate until the user approves.

## Step 5. Create

1. Infer a short descriptive kebab-case id from the problem.
2. Run `scripts/dev-docs-preflight.sh start-issue <id>` to verify the id is unique (dual-path: the tracker and the local `dev-docs/issues/` directories). If the gate fails, stop and report.
3. Assemble the approved body (the four sections, plus the `**Stack:** <name>` line when applicable) and pipe it to `scripts/linear.sh create-issue <id> "<title>"`. The issue is created in the backlog state, carrying the janus id in its title prefix.
4. Read the `url:` line from the script output and report it (see Expected Response).

## Stop Condition

Stop immediately after capturing the backlog issue.
Do not create a plan.
Do not create a design.
Do not edit product code.
Do not edit tests.
Do not approve anything.
Do not move any files.

## Expected Response

```
Captured Linear issue `<id>` (<identifier>) in backlog: <url>
Next skill:
/open-issue <id>
```

## Key Principles

- **One question at a time** -- do not overwhelm with multiple questions.
- **Multiple choice preferred** -- easier to answer than open-ended when feasible.
- **Problem only** -- no solutions, no implementation tasks, no code changes.
- **Description layering** -- non-technical lead paragraph, then technical depth.
- **Concrete over vague** -- specific files, services, error codes, config keys.
- **Skip what you know** -- if the user or stack already answered a question, do not re-ask.
- **Scale to the issue** -- a trivial bug may need only one or two questions; do not force a full interview on a one-line defect. Stop early when you have enough.
- **Landscape, not design** -- capture what exists and the constraints that bound the solution; do not pre-solve the plan. Removing the old "start without re-investigation" framing is the real fix; this principle restates it, and the constraint-vs-open-choice tiebreaker lives in the Interview rules.
- **Respect the harness** -- all preconditions, lifecycle rules, and the tracker operations contract from `dev-docs/harness/` apply.
- **Project-agnostic** -- this skill references only root `AGENTS.md` and files under `dev-docs/`. Project-specific specs, source directories, and service structure live in the repo's own `AGENTS.md` and sub-`AGENTS.md` files, not in this skill.
