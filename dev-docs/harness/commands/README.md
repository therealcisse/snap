# Harness Commands

This directory contains command-specific protocols for Janus agents.

## Why Commands Are Separate

Each lifecycle command has a narrow responsibility.
Separating command protocols prevents the agent from collapsing workflow stages.

## Command Files

- `create-stack.md`
- `update-stack.md`
- `approve-plan.md`
- `approve-design.md`

## Shared Rules

These rules apply to every command.

### Read the Correct Protocol

When a user gives a recognized command, read and follow the matching command file.
Do not execute another lifecycle command unless the user explicitly asks for it.

### Do Not Collapse Stages

Do not combine lifecycle stages.

Examples:

- `Start an issue` creates only an open issue.
- `Plan issue` creates only a proposed plan.
- `Approve plan` prints only a human move command.
- `Implement plan` implements only an approved plan.
- `Design plan` writes only a proposed realized design.
- `Approve design` prints only a human move command.
- `Close plan` prints only a human move command.
- `Close issue` records closeout notes and prints only the human-gated close (a `mv` for local issues, a tracker deep-link for Linear issues).

### Human Moves

When a command's final move is into an approved, done, or closed directory, print the exact `mv` command for the human to run; do not run it.
For tracker (Linear) issues, print the issue's tracker deep-link for the human to set Done instead of an `mv`.

### Immutable Directories

Never edit files in:

- `dev-docs/designs/approved/`
- `dev-docs/plans/approved/`
- `dev-docs/plans/done/`
- `dev-docs/issues/closed/`

### Optional Ids

For commands where `<id>` is optional, infer it only if there is exactly one matching active artifact after ignoring examples.
If zero or multiple candidates exist, ask for the id.

### Example Documents

Ignore example documents with either:

- `id: example`
- filename stem `example`

### Stop Conditions

Every command has a stop condition.
The stop condition is mandatory.
