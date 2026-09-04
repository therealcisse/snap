# Plan Issue (Interactive)

Creates an implementation plan for an open issue through guided Q&A, then writes it to `dev-docs/plans/approved/`.

<HARD-GATE>
Do NOT create the plan file until you have completed the interview and the user has approved the draft. Do not edit product code. Do not edit tests.
</HARD-GATE>

## Operational Directives

### Allowed Writes

- `dev-docs/plans/approved/<plan-id>.md`

Note: this skill writes straight to `approved/` after an in-chat user review of the draft. There is no separate approve step and no write to `proposed/`.

### Forbidden Writes

- Product code.
- Tests.
- `dev-docs/issues/`, except reading the originating open issue.
- `dev-docs/plans/proposed/`.
- `dev-docs/plans/done/`.
- `dev-docs/designs/`.
- Root `AGENTS.md`, unless explicitly requested and justified.
- Subdirectory `AGENTS.md` files, unless explicitly requested and justified.

## Checklist

Complete these steps in order:

1. **Resolve issue id** -- find or confirm the target issue
2. **Gather context** -- read harness files, the issue, specs, code
3. **Interview** -- ask clarifying questions one at a time
4. **Draft** -- present the plan for user review
5. **Place** -- create the file in approved/, run preflight

## Step 1. Resolve Issue Id

If the user provided an issue id, use it.

If no id was provided:
- List non-example `.md` files in `dev-docs/issues/open/` and run `scripts/linear.sh list open`.
- If exactly one open issue exists across both, use it.
- If zero or multiple exist, ask the user which issue to plan.

## Step 2. Gather Context

Read these files (skip if already in context):

- `AGENTS.md`
- `dev-docs/harness/README.md`
- `dev-docs/harness/dev-docs-schema.md`
- `dev-docs/harness/active-artifact-preconditions.md`
- `dev-docs/harness/tracker.md`
- `.agents/skills/linear/SKILL.md`
- The originating issue: the local file `dev-docs/issues/open/<issue-id>.md`, or `scripts/linear.sh fetch <issue-id>` for a tracker issue.

Then investigate the codebase based on what the issue covers. Use the root `AGENTS.md` and sub-`AGENTS.md` files as the map to find relevant source, tests, config, and schemas:

- Relevant service directories identified by the repository map in `AGENTS.md`.
- Relevant sub-`AGENTS.md` and `GUIDELINES.md` files for the affected services.
- Any existing completed plans in `dev-docs/plans/done/` or approved designs in `dev-docs/designs/approved/` related to the issue.
- Recent commits or branch state relevant to the issue.

To discover related issues across both stores, run `scripts/linear.sh sync` (materializes every tracker issue into the shared cache), then grep `~/.cache/janus/issues/` and `dev-docs/issues/` for prior context.

The goal is to understand the current state deeply enough to write concrete tasks with exact file paths.

## Step 3. Interview

Ask questions **one at a time**. Prefer multiple-choice when possible. Open-ended is fine when the answer space is too broad.

Adapt the sequence based on answers. Skip questions the issue or codebase already answers. Stop when you have enough to write all plan sections (Context, Current State, Developer Feedback, Approach, Tasks, Documentation Impact, Acceptance Tests).

### Question sequence

The sequence below is a guide, not a rigid script. Reorder, merge, or skip based on what is already known. The goal is to fill every section with concrete, specific content.

**Scope and strategy**

1. **Should this be one plan or multiple incremental plans?**
   Some issues are large enough to warrant step-by-step plans (spec first, then implementation, then tests). Others fit in a single plan. If unsure, present your recommendation with reasoning.

2. **How should this be solved? Drive the design here.**
   Investigate the code, then present viable approaches with trade-offs and your recommendation. This is where the technical reasoning lands. Present approaches only where the issue genuinely admits more than one; if the design is forced by spec or by a single correct fix, skip to draft and say so. Do not manufacture ritual alternatives for obvious designs.

3. **What design decisions need a call before the task list is written, and what alternatives are being rejected?**
   Anything that would materially change the task list: API shape, storage layout, error handling strategy, ordering of steps, dependency introduction, breaking changes. Record the chosen option AND each rejected one with a one-line reason. These go into Developer Feedback so the reasoning survives.

**Technical details**

4. **Which services/modules/files are in scope?**
   Confirm the blast radius. Get specific paths.

5. **Are there constraints the plan must respect?**
   Existing patterns, performance requirements, backward compatibility, deployment ordering, feature flags, schema migration rules.

6. **What should be explicitly excluded from this plan step?**
   Related work that belongs in a later plan step or a separate issue.

### Interview rules

- One question per message.
- If the user's answer covers multiple upcoming questions, skip them.
- If an answer is vague, follow up once for specifics before moving on.
- Never ask more than 8 questions total. If you have enough after 3-4, stop.
- Summarize your understanding after the last question before proceeding to the draft.
- If the issue and codebase are clear enough that no questions are needed, skip straight to the draft and note that you are doing so. This knob is for small, forced-design plans; heavier issues run the full Q2/Q3 design exploration.

## Step 4. Draft

Present the complete plan in the chat for review. Use this structure:

```
**Proposed plan id:** `<kebab-case-id>`

---
title: <title>
date: <YYYY-MM-DD>
author: agent
id: <plan-id>
issue: <issue-id>
research: []
designs: []
---

## Context

<Why this plan exists. What problem it solves. Reference the originating issue by id. The technical design reasoning is authored here in this plan, not inherited from the issue; the issue only frames the problem and the landscape.>

## Current State

<What exists today. Files, modules, implementations, tests, config.
Be specific with paths and line numbers where relevant.
Include what is missing or incomplete that this plan addresses.>

## Developer Feedback

<Record decisions and feedback from the interview. Attribute specific choices.
Every approach the interview weighed should appear here: the chosen one and each
rejected one with a one-line reason. This is the durable record of the design
brainstorm, because the issue could not hold it.>

## Approach

<Step-by-step strategy. Ordered. Each step should be a coherent unit of work.
Include concrete details: file paths, class names, method signatures, config keys,
table structures. Show code where it clarifies intent.
Scope this step only -- do not overflow into later plan steps.>

## Tasks

- [ ] <Task 1. Concrete, with file path.>
- [ ] <Task 2. Concrete, with file path.>
...

## Documentation Impact

<Which docs, specs, schemas, READMEs, or AGENTS.md files need updating.
What changes in each.>

## Acceptance Tests

<How to verify this plan step is complete.
Specific test scenarios, commands to run, outcomes to check.
Include docs tests when behavior, workflow, layout, or public contracts change.>
```

Ask:

> Does this look right? Any changes before I create the file?

Iterate until the user approves.

## Step 5. Place

1. Infer the plan id (usually matches the issue id, or a descriptive kebab-case id if the issue needs multiple plans).
2. Run `scripts/dev-docs-preflight.sh plan-issue <issue-id>` to verify preconditions pass. If the gate fails, stop and report.
3. Create the plan file at `dev-docs/plans/approved/<plan-id>.md`.
4. Report the created path and the next skill.

## Stop Condition

Stop immediately after creating the plan file.
Do not edit product code.
Do not edit tests.
Do not implement the plan.
Do not create a realized design.
Do not close the issue.
Do not move the plan.

## Expected Response

```
Created `dev-docs/plans/approved/<plan-id>.md`.
Next skill:
/implement-plan <plan-id>
```

## Key Principles

- **One question at a time** -- do not overwhelm with multiple questions.
- **Multiple choice preferred** -- easier to answer than open-ended when feasible.
- **Concrete over vague** -- specific file paths, class names, method signatures, config keys in every task.
- **No placeholders** -- every task must contain actual detail. No "TBD", "TODO", "implement later", or "add appropriate error handling".
- **Skip what you know** -- if the issue, specs, or codebase already answer a question, do not re-ask.
- **Writes directly to approved/** -- no destination prompt.
- **Respect the harness** -- all preconditions, frontmatter, and lifecycle rules from `dev-docs-schema.md` apply.
- **Project-agnostic** -- this skill references only root `AGENTS.md` and files under `dev-docs/`. Project-specific specs, source directories, and service structure live in the repo's own `AGENTS.md` and sub-`AGENTS.md` files, not in this skill.
