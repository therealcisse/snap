# AGENTS.md Ownership and Diff Policy

This file defines when agents may edit root or subdirectory `AGENTS.md` files.

## Purpose

`AGENTS.md` files are durable maps for agents.
They are not:

- Implementation journals.
- Feature status reports.
- Closeout summaries.
- Issue-specific memory.
- Library tutorials.
- Temporary notes.
- Duplicates of README, specs, plans, designs, stacks, or skills.

## File Roles

### Root `AGENTS.md`

Root `AGENTS.md` contains only project-wide, durable agent guidance:

- Project identity.
- Repository map.
- Source-of-truth pointers.
- Sub-`AGENTS.md` precedence.
- Global invariants.
- Command routing.
- Human gate rules.
- Immutability rules.
- Pointer to this ownership policy.

### Subdirectory `AGENTS.md`

A subdirectory `AGENTS.md` contains durable rules for its own tree.

Examples:

- `spec/AGENTS.md` owns spec-document mechanics.
- `identity/AGENTS.md` owns Identity service implementation rules.
- `session/AGENTS.md` owns Session service implementation rules.
- `commons/AGENTS.md` owns shared primitive library rules.
- `dynamodb/AGENTS.md` owns shared DynamoDB abstraction rules.
- `todo/AGENTS.md` owns Todo API implementation rules.

Subdirectory `AGENTS.md` files take precedence over root `AGENTS.md` inside their own tree.

## Valid Reasons to Edit Root AGENTS.md

A root `AGENTS.md` change must fit at least one category.

### Navigation

Use this category for:

- New stable source of truth.
- Moved stable repository-wide docs.
- New command family.
- New skills index.
- New stable harness area.

### Global Invariant

Use this category for:

- A rule that applies across the whole repository.
- A rule expected to remain true for months.
- A rule whose violation creates broad project risk.
- A rule that is not owned by a narrower subdirectory.

### Protocol

Use this category for:

- Lifecycle command routing.
- Human gate responsibilities.
- Artifact immutability.
- Command precondition pointers.
- Agent or human responsibility boundaries.

### Precedence

Use this category for:

- How root and subdirectory `AGENTS.md` files interact.
- Which file wins when guidance conflicts.
- How agents should find the nearest rules.

## Valid Reasons to Edit a Subdirectory AGENTS.md

A subdirectory `AGENTS.md` change must fit at least one category.

### Local Invariant

A durable rule that applies throughout the subtree.

### Local Navigation

A stable pointer to local source-of-truth files.

### Local Build or Test Map

A stable description of how to discover local build, test, type-check, or lint commands.

### Local Architecture Boundary

A durable rule about package layering, dependencies, module responsibilities, or source layout inside that subtree.

## Invalid Reasons to Edit Any AGENTS.md

Do not edit any `AGENTS.md` for:

- Feature completion status.
- Route implementation progress.
- Temporary known gaps.
- Issue-specific decisions.
- Plan-specific approach.
- Realized design details.
- Closeout summaries.
- Developer preference that has not been accepted as a durable rule.
- Detailed Scala syntax recipes.
- Detailed Cats or Cats Effect recipes.
- Detailed Play controller recipes.
- Detailed Scanamo or DynamoDB recipes.
- Test examples that belong in tests or skills.
- Duplicated content from README, specs, plans, designs, stacks, or skills.

## Destination Rules

When tempted to edit `AGENTS.md`, route the information first.

| Information | Destination |
|---|---|
| Product contract | `spec/` |
| Current product overview | `README.md` |
| Current implementation gap | `dev-docs/stacks/` |
| Issue-specific problem | `dev-docs/issues/` |
| Implementation approach | `dev-docs/plans/` |
| Realized architecture | `dev-docs/designs/` |
| Research or prior art | `dev-docs/research/` |
| Reusable technical recipe | `skills/` |
| Workflow command detail | `dev-docs/harness/commands/` |
| Dev-docs schema | `dev-docs/harness/dev-docs-schema.md` |
| Stack mechanics | `dev-docs/harness/stacks.md` |
| AGENTS ownership | `dev-docs/harness/agents-policy.md` |
| Mechanical enforcement | `scripts/` |

## Required Diff Classification

Before editing root `AGENTS.md` or any subdirectory `AGENTS.md`, the agent must classify the change.
Use this checklist in the final response or in the plan that proposes the change:

```
## AGENTS.md Change Classification
- File:
- Proposed change:
- Category: Navigation | Global invariant | Protocol | Precedence | Local invariant | Local navigation | Local build/test map | Local architecture boundary
- Why this belongs in AGENTS.md:
- Why this does not belong in README, spec, issue, plan, design, stack, harness command, or skill:
- Expected durability:
```

If the agent cannot fill this out convincingly, it must not edit `AGENTS.md`.

## Close Issue Behavior

During `Close issue <id>`, the agent reviews root `AGENTS.md`, subdirectory `AGENTS.md` files, `README.md`, and `GUIDELINES.md` files for staleness, omissions, inconsistencies, and bloat introduced by the completed work.

When the review finds a possible `AGENTS.md` change:

1. Classify the change using the required diff classification.
2. If it does not qualify, route it to the correct destination.
3. If it qualifies, make the smallest durable edit.
4. Do not add feature status to `AGENTS.md`.
5. Do not duplicate README, spec, plan, design, stack, or skill content.

## Bloat Check

An `AGENTS.md` change is suspicious if it:

- Adds details about one completed issue.
- Adds a list of currently implemented routes.
- Adds a temporary warning.
- Adds code examples longer than a few lines.
- Repeats source-of-truth content from another file.
- Makes root `AGENTS.md` more like a manual than a map.

If suspicious, stop and route the information elsewhere.

## Preferred Patterns

Prefer this:

> When editing Scala code, use relevant skills under `skills/`.

Avoid this:

> Root `AGENTS.md` contains a long Scala 3, Cats Effect, Play, and Scanamo tutorial.

Prefer this:

> Detailed lifecycle command steps live in `dev-docs/harness/commands/`.

Avoid this:

> Root `AGENTS.md` contains the full text of every lifecycle command.

Prefer this:

> Current implementation gaps live in `dev-docs/stacks/`.

Avoid this:

> Root `AGENTS.md` lists every route that remains unfinished.
