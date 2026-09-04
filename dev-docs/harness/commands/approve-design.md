# Approve Design

## Intent

Verify that a proposed design is ready for approval, run the preflight script, then execute the move to approved.
This command applies to both intent designs and realized designs.

## Allowed Writes

- `dev-docs/designs/approved/<id>.md` (the move target, created by this command).
- If the user explicitly asks for small corrections before approval: `dev-docs/designs/proposed/<id>.md`.

## Forbidden Writes

- Product code.
- Tests.
- `dev-docs/designs/approved/`, except the move target created by this command.
- `dev-docs/plans/approved/`.
- `dev-docs/plans/done/`.
- `dev-docs/issues/closed/`.
- Root `AGENTS.md`, unless explicitly requested and justified.
- Subdirectory `AGENTS.md` files, unless explicitly requested and justified.

## Required Reads

- `AGENTS.md`
- `dev-docs/harness/README.md`
- `dev-docs/harness/dev-docs-schema.md`
- This command file.
- `dev-docs/designs/proposed/<id>.md`

## Preconditions

Run `scripts/dev-docs-preflight.sh approve-design <id>` before proceeding.
The script verifies: design exists in proposed/, approved target clear.

- The design is ready for human approval based on the user's instruction.

## Id Inference

If `<id>` is omitted, infer it only if exactly one non-example design exists in `dev-docs/designs/proposed/`.
If zero or multiple candidates exist, ask for the design id.

## Procedure

1. Read the proposed design.
2. Verify the approved target file does not already exist.
3. Verify the user has indicated the design is ready for approval.
4. Execute:

   ```
   mv dev-docs/designs/proposed/<id>.md dev-docs/designs/approved/<id>.md
   ```

## Stop Condition

Stop after executing the move.
Do not move any plan.
Do not create a commit.
Do not close anything.

## Expected Response

```
Design approval checks passed.
Moved dev-docs/designs/proposed/<id>.md -> dev-docs/designs/approved/<id>.md
```

If the design realizes a plan, the next step after the move is typically `Close plan <plan-id>`. If the design is not tied to a plan, omit the next-command hint.
