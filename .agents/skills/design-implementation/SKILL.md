# Design Implementation (Interactive)

Creates one realized design per plan by inspecting the implemented plan and the resulting code. Each design is named after the plan id.

<HARD-GATE>
Do NOT edit implementation code. Do not move plans. Do not close anything. Do not create commits.
</HARD-GATE>

## Operational Directives

### Allowed Writes

- `dev-docs/designs/approved/<plan-id>.md`
- Post a design summary as a Linear comment via `scripts/linear.sh comment <issue-id>` (tracker issues only).

Note: this skill writes straight to `approved/` after an in-chat user review of the draft. There is no separate approve step and no write to `proposed/`.

### Forbidden Writes

- Product code.
- Tests.
- `dev-docs/plans/approved/<id>.md`
- `dev-docs/plans/done/`
- `dev-docs/issues/closed/`
- `dev-docs/designs/proposed/`
- Root `AGENTS.md`, unless explicitly requested and justified.
- Subdirectory `AGENTS.md` files, unless explicitly requested and justified.

## Checklist

1. **Resolve plan id** -- use the given id or infer from context
2. **Gather context** -- read harness files, the plan, implementation code
3. **Interview** -- ask clarifying questions one at a time if needed
4. **Draft design** -- present the realized design for user review
5. **Place** -- create the file in approved/
6. **Post design summary** -- tracker issues only

## Step 1. Resolve Plan Id

If the user provided a plan id, use it.

If no id was provided:
- List `.md` files in `dev-docs/plans/approved/`.
- If exactly one exists, use it.
- If zero or multiple exist, report and ask for the plan id.

## Step 2. Gather Context

Read these files (skip if already in context):

- `AGENTS.md`
- `dev-docs/harness/dev-docs-schema.md`
- `dev-docs/plans/approved/<plan-id>.md`

Then find the referenced issue for context (the plan's frontmatter `issue` field). Read the issue: the local file `dev-docs/issues/open/<issue-id>.md`, or `scripts/linear.sh fetch <issue-id>` for a tracker issue.

Check if a design already exists for this plan (check `dev-docs/designs/proposed/` and `dev-docs/designs/approved/` for `<plan-id>.md`). If one already exists in `approved/`, stop and inform the user. If one exists in `proposed/`, ask the user whether to replace it.

Inspect the implementation for all plans:
- Relevant source files changed by each plan.
- Relevant test files.
- Relevant specs.
- Relevant sub-`AGENTS.md` and `GUIDELINES.md` files.

## Step 3. Interview

Ask questions **one at a time** if the implementation is unclear or ambiguous. Skip the interview entirely if the code is straightforward and speaks for itself.

Typical questions:
- **Does this plan's implementation match the approach, or were there deviations?** If there were deviations, what drove them?
- **Are there decisions made during implementation that should be recorded in the design?**
- **Is there follow-up work this plan introduced that should be noted?**

### Interview rules

- One question per message.
- If the code is clear, skip straight to the draft.
- Never ask more than 5 questions total.

## Step 4. Draft Design

Present the combined realized design in the chat for review. Use this structure:

```
**Proposed design id:** `<plan-id>`

---
title: <title>
date: <YYYY-MM-DD>
author: agent
id: <plan-id>
issue: <issue-id>
plan: <plan-id>
---

## Summary

<One paragraph: what was built and why.>

## Plan Realized

### <plan-id>

<Reference to the plan. Note any deviations from the original approach.>

## Implementation

<What was actually built across all plans. Files, modules, key types, wiring changes.
Concrete enough that a reader can reconstruct the implementation from this section.>

## Behavior

<Runtime behavior: what the code does when exercised.
Request/response shapes, state transitions, side effects.>

## Tests

<What tests exist, what they cover, notable gaps if any.>

## Decisions

<Implementation decisions made during coding that are not obvious from the plans.
Why something was done a particular way.>

## Follow-Up

<Work introduced by this implementation that should be captured in future plans or issues.>
```

Ask:

> Does this design look right? Any changes before I create the file?

Iterate until the user approves.

## Step 5. Place

Create the design file at `dev-docs/designs/approved/<plan-id>.md`.

## Step 6. Post Design Summary (Tracker Issues Only)

A realized design lives in the repo, but a tracker (Linear) issue lives in another system and its readers see only the issue body and comments. Bridge that gap by posting a design summary comment so the Linear record carries what was actually built, not just what was asked for.

Local issues need no comment: their design sits next to them in git, so there is nothing to bridge. Detect the store as in close-plan: if `dev-docs/issues/open/<issue-id>.md` exists it is local (skip this step); otherwise it is a tracker issue (post the comment).

For a tracker issue, pipe the comment body to `scripts/linear.sh comment <issue-id>`. Use this structure:

```
## Design Summary

<!-- design-summary: <plan-id> -->

Full design: /dev-docs/designs/approved/<plan-id>.md

<One or two accessible sentences stating the outcome: what changed, in terms an
engineer or PM who has not read the code can follow. This is what shipped, not how.>

Key points:
- <Technical specifics: the main types, modules, or wiring that changed, with concrete
  file or module names. This is the how, for engineers who want it.>
- <A notable decision or deviation from the plan, pulled from the design Decisions section.
  State the why, not just the what. One per bullet.>
- ...

<!-- /design-summary -->
```

Content rules:
- **Layered, not duplicated.** Lead with an accessible outcome line, then technical specifics. This mirrors the issue description's own layering (non-technical lead, then technical depth). Do not write two separate summaries.
- **Surface the Decisions.** Decisions and deviations are the highest-value content for a Linear reader, because that is where the build diverged from the plan. Pull them from the design `## Decisions` section.
- **Pointer over copy.** Include the Summary and the key Decisions only. Implementation, Behavior, Tests, and Follow-Up stay in the repo design; the root-relative path carries the reader to them.
- **No links in the repo.** Reference the design by root-relative path (`/dev-docs/...`), never a clickable URL. The Linear comment is the only place a tracker is involved; the repo stays tracker-agnostic.

## Stop Condition

Stop after creating the design file and, for tracker issues, posting the design summary comment.
Do not move plans to done.
Do not close the issue.
Do not edit implementation code.
Do not create commits.

## Expected Response

After the design is created:

```
Created realized design for plan <plan-id>:
- `dev-docs/designs/approved/<plan-id>.md`
- Posted design summary to Linear issue <issue-id> (tracker issues only).
Next skill:
/close-plan <plan-id>
```

## Key Principles

- **One design per plan** -- a single design document covers one plan.
- **Named after the plan id** -- the design file shares the plan id for traceability.
- **Plan must be in approved/** -- the design must be created before the plan moves to done. If the plan is in done/ or proposed/, stop and inform the user.
- **Describes truthfully** -- record what was actually built, not what was planned.
- **Writes directly to approved/** -- no destination prompt.
- **Project-agnostic** -- this skill references only root `AGENTS.md` and files under `dev-docs/`.
