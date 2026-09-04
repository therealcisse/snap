# Update Stack

## Intent

Refresh one existing stack against the current code and specs.

## Allowed Writes

- `dev-docs/stacks/<name>.md`

## Forbidden Writes

- Product code.
- Tests.
- `dev-docs/issues/`.
- `dev-docs/plans/`.
- `dev-docs/designs/`.
- Root `AGENTS.md`, unless explicitly requested and justified.
- Subdirectory `AGENTS.md` files, unless explicitly requested and justified.

## Required Reads

- `AGENTS.md`
- `dev-docs/harness/stacks.md`
- This command file.
- `dev-docs/stacks/<name>.md`
- Relevant specs.
- Relevant implementation files.
- Relevant README and sub-`AGENTS.md` files for the scoped area.

## Preconditions

Run `scripts/dev-docs-preflight.sh update-stack <name>` before proceeding.
The script verifies the stack file exists and has name and description frontmatter.

- Active-artifact preconditions do not apply.

## Procedure

1. Read the stack.
2. Reuse the frontmatter `description` as the diff scope.
3. Read relevant specs and implementation files.
4. Re-run the scoped diff.
5. Check off previously unchecked items now satisfied by the code.
6. Add new unchecked items for gaps not previously captured.
7. Do not uncheck items.
8. Preserve checked items for visibility.
9. Report what changed.

## Stop Condition

Stop after updating the stack.
Do not create an issue.
Do not create a plan.
Do not implement.

## Expected Response

```
Updated `dev-docs/stacks/<name>.md`.
Summary:
- Checked off:
- Added:
- Left unchanged:
```
