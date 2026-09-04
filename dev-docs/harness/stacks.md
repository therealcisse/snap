# Stacks

Stacks are scoped completion checklists derived from spec or implementation diffs.

## Purpose

A stack captures implementation gaps inside a bounded scope.
Stacks are used to create focused issues without losing the larger completion picture.

## Location

Stacks live in:

```
dev-docs/stacks/<name>.md
```

## Frontmatter

A stack has YAML frontmatter:

```yaml
---
name:
description:
---
```

The `name` is a short `kebab-case` stack name.
The `description` scopes the diff and is reused by `Update stack`.

## Body Format

The body contains markdown sections and checkboxes.

Example:

```markdown
# Session Minimum Passwordless Stack
## Exchange
- [x] Implement exchange route.
- [ ] Add exchange token validation edge cases.
## Refresh
- [ ] Implement refresh route.
- [ ] Add refresh token reuse detection tests.
```

## Stack Items

Stack items represent implementation state, not issue state.

One issue may check off multiple stack items.
One stack item may require multiple plans if the work is large.
Checked items stay in the file for visibility.
Do not uncheck items during `Update stack`.

## Ordering

Order within a section is priority.
The top unchecked item is normally the next candidate for `Start an issue from <stack>`.
The agent may group multiple adjacent related unchecked items into one issue when they are naturally part of the same problem.

## Create Stack

Use `dev-docs/harness/commands/create-stack.md`.

## Update Stack

Use `dev-docs/harness/commands/update-stack.md`.

## Close Issue Interaction

During `Close issue <id>`, if the issue has a `stack` frontmatter field, the agent analyzes the implementation against the stack file.
The agent checks off all stack items now satisfied by the code, based on implementation state rather than only the issue's stated scope.

## Rules

- Stack descriptions must be scoped.
- Stack updates are based on code and spec state.
- Do not turn stack items into solution documents.
- Do not uncheck previously checked items.
- Do not use stacks to bypass issue and plan lifecycle.
- Do not close an issue merely because one stack item is checked if related plans or designs are incomplete.
