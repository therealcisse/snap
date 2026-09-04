# AGENTS.md

## Purpose

This file is the stable project-wide map for agents working in this repository.
It is not the source of truth for detailed lifecycle procedures, implementation status, issue-specific decisions, or temporary project notes. Keep this file short, durable, and navigational.

The Dev-Docs Workflow, Command Routing, Human Gates, Immutability, and AGENTS.md Change Policy sections are the harness wiring; keep them as-is.

## Project

Snap is a small local version control system built around vector-clock versions, patch replay, and deterministic automatic merging: eight everyday commands plus a read-only HTTP mode, implemented in TypeScript under `ts/`.

[`SPEC.md`](SPEC.md) is the canonical product contract. Public behavior must be demonstrated in the language-neutral YAML suite under [`tests/`](tests/). You may add language-specific unit tests while developing, but they cannot replace the shared acceptance suite.

When implementation work reveals an ambiguity or contradiction, correct the spec first or in the same commit and add a regression case to the public YAML suite. Do not silently make the implementation authoritative.

## Repository Map

- `SPEC.md`: canonical behavioral contract.
- `README.md`: product overview and usage.
- `TEST-HARNESS.md`: the YAML test format contract.
- `tests/`: language-neutral YAML acceptance suite (the acceptance criteria).
- `test-harness/`: TypeScript driver for the YAML suite; imports no implementation code.
- `ts/`: TypeScript implementation. See `ts/AGENTS.md`.
- `run`, `verify`, `run_tests`: launcher and acceptance-test entry points.
- `dev-docs/`: harness workflow rules and lifecycle artifacts (issues, plans, designs, stacks, research).
- `.agents/skills/`: interactive lifecycle skills.
- `scripts/`: mechanical precondition checks and tracker backend.

## Build and Test

After implementation changes, run the shared acceptance suite from the repository root:

```bash
./verify --lang ts
```

After harness changes, also run:

```bash
cd test-harness
npm run check
npm test
```

Language-specific build and type-check commands live in `ts/AGENTS.md`.

## Global Invariants

Tracker (Linear) issues are keyed by the stable kebab-case janus id (stored in the Linear title as `[<id>]`); the Linear identifier (`THE-n`) is a deep-link convenience, not the reference key. `LINEAR_API_KEY` is required for tracker issue lifecycle operations (see `dev-docs/harness/tracker.md`). Local issues live in-repo under `dev-docs/issues/` and require no API key.

Implementation layout: keep responsibilities separate — versions, text/diff and OT, repository validation and replay, filesystem materialization, working-tree changes, HTTP, commands, and CLI dispatch.

Harness neutrality: the YAML harness is implementation-language neutral. Never import reference code into it or add shell setup operations to test around a missing typed operation. Extend its tagged unions additively so existing format-1 cases keep their meaning.

Scope discipline: Snap's small surface is deliberate. Do not add branches, staging, checkout, push, authentication, object storage, or unresolved-conflict machinery. Spend complexity on deterministic behavior, strict validation, and exact tests — not on production scalability or command count.

## Dev-Docs Workflow

All detailed workflow rules live under `dev-docs/harness/`.

Read these files as needed:

- `dev-docs/harness/README.md`: workflow overview, lifecycle summary, and general rules.
- `dev-docs/harness/dev-docs-schema.md`: document types, frontmatter schema, ids, filenames, and naming rules.
- `dev-docs/harness/active-artifact-preconditions.md`: active-work gate used by `Plan issue`.
- `dev-docs/harness/agents-policy.md`: when and how to edit `AGENTS.md` files, destination rules, and bloat checks.
- `dev-docs/harness/stacks.md`: stack model, create/update procedures, and close-issue interaction.
- `dev-docs/harness/commands/`: one file per surviving command-driven stage (stack, approve plan, approve design).
- `.agents/skills/`: interactive skills for the authoring lifecycle stages (new issue, new local issue, open issue, plan, implement, design, close plan, close issue).
- `dev-docs/harness/tracker.md`: tracker operations contract for the Linear-backed issue lifecycle.
- `.agents/skills/linear/SKILL.md`: the concrete Linear tracker backend (`scripts/linear.sh`).

Verification scripts in `scripts/` mechanize precondition checks:

- `scripts/dev-docs-preflight.sh <command> [id]`: single precondition gate for all lifecycle commands. Run before every command.

## Command Routing

When the user gives one of these commands, follow only the matching command protocol.

The main authoring lifecycle (new issue, new local issue, open issue, plan issue, implement plan, design implementation, close plan, close issue) is skill-driven. Skills live in `.agents/skills/` and are invoked as `/new-issue`, `/new-local-issue`, `/open-issue`, `/plan-issue`, `/implement-plan`, `/design-implementation`, `/close-plan`, `/close-issue`. The table below covers only the remaining command-driven stages.

| Command | Protocol |
|---|---|
| `Create stack <description>` | `dev-docs/harness/commands/create-stack.md` |
| `Update stack <name>` | `dev-docs/harness/commands/update-stack.md` |
| `Approve plan <id>` | `dev-docs/harness/commands/approve-plan.md` |
| `Approve design <id>` | `dev-docs/harness/commands/approve-design.md` |

Do not collapse lifecycle stages. Creating an issue does not imply opening it. Opening an issue does not imply planning. Planning does not imply approval. Approval does not imply implementation. Implementation does not imply realized design. Realized design does not imply approval. Approval does not imply closeout.

## Human Gates

Agents write artifacts and code.

Agents execute lifecycle moves after precondition checks pass for `approve plan`, `approve design`, and `close plan`.

Humans gate only the final move into a closed issue:

- Local file issue: the move into `dev-docs/issues/closed/`. The agent prints the exact `mv` command; it does not run it.
- Tracker (Linear) issue: the move to Done. The agent prints the issue's tracker deep-link; it never sets Done itself.

## Immutability

Approved, done, and closed artifacts are immutable permanent records.

Agents must never modify files in:

- `dev-docs/designs/approved/`
- `dev-docs/plans/approved/`
- `dev-docs/plans/done/`
- `dev-docs/issues/closed/`

Do not rewrite these immutable artifacts solely to update their metadata.

## AGENTS.md Change Policy

Only edit this file for durable project-wide agent behavior, repository navigation, global invariants, command routing, or precedence rules.

Do not edit this file for:

- Feature completion status.
- Route implementation progress.
- Pending routes.
- Completed routes.
- Current dependencies.
- Feature progress.
- Temporary known gaps.
- Issue-specific decisions.
- Closeout summaries.
- Detailed library recipes.
- Duplicated content from README, specs, plans, designs, stacks, or skills.

Implementation status, completed routes, pending routes, current dependencies, and feature progress must not be recorded in root `AGENTS.md`.

Before editing this file or any sub-`AGENTS.md`, read `dev-docs/harness/agents-policy.md` and classify the proposed change.
