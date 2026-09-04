# Create Stack

## Intent

Create one scoped completion checklist derived from a spec or implementation diff.

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
- `dev-docs/harness/README.md`
- `dev-docs/harness/dev-docs-schema.md`
- `dev-docs/harness/stacks.md`
- This command file.
- Relevant specs.
- Relevant implementation files.
- Relevant README and sub-`AGENTS.md` files for the scoped area.

## Preconditions

Run `scripts/dev-docs-preflight.sh create-stack <name>` before proceeding.
The script verifies the stack file doesn't already exist.

- The user provides a stack description.
- Infer a short descriptive kebab-case stack name.
- Active-artifact preconditions do not apply.

## Procedure

1. Infer a short descriptive kebab-case name from the description.
2. Read relevant specs and implementation files for the requested scope.
3. Perform a scoped spec or implementation diff.
4. Create `dev-docs/stacks/<name>.md`.
5. Add frontmatter:

   ```yaml
   ---
   name: <name>
   description: <description>
   ---
   ```

6. Populate sections by route, feature, layer, or other natural scope.
7. Add markdown checkboxes for gaps.
8. Order unchecked items by priority within each section.
9. Mark already-satisfied items checked when useful for context.
10. Report the created file.

## Stop Condition

Stop after creating the stack.
Do not create an issue.
Do not create a plan.
Do not implement.

## Expected Response

```
Created `dev-docs/stacks/<name>.md`.
Next command when ready:
Start an issue from <name>
```
