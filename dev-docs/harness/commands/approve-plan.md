# Approve Plan

## Intent

Verify that a proposed plan is ready for approval, run the preflight script, then execute the move to approved.

## Allowed Writes

- `dev-docs/plans/approved/<id>.md` (the move target, created by this command).
- If the user explicitly asks for small corrections before approval: `dev-docs/plans/proposed/<id>.md`.

## Forbidden Writes

- Product code.
- Tests.
- `dev-docs/issues/`.
- `dev-docs/plans/approved/`, except the move target created by this command.
- `dev-docs/plans/done/`.
- `dev-docs/designs/`.
- Root `AGENTS.md`, unless explicitly requested and justified.
- Subdirectory `AGENTS.md` files, unless explicitly requested and justified.

## Required Reads

- `AGENTS.md`
- `dev-docs/harness/README.md`
- `dev-docs/harness/dev-docs-schema.md`
- `dev-docs/harness/tracker.md`
- This command file.
- `dev-docs/plans/proposed/<id>.md`
- The originating issue: the local file `dev-docs/issues/open/<issue-id>.md`, or `scripts/linear.sh fetch <issue-id>` for a tracker issue.

## Preconditions

Run `scripts/dev-docs-preflight.sh approve-plan <id>` before proceeding.
The script verifies: plan exists in proposed/, approved and done targets clear, plan has `issue` field, originating issue exists (Linear or open/, dual-path).

- The plan is ready for human approval based on the user's instruction.

## Id Inference

If `<id>` is omitted, infer it only if exactly one non-example plan exists in `dev-docs/plans/proposed/`.
If zero or multiple candidates exist, ask for the plan id.

## Procedure

1. Read the proposed plan.
2. Verify the originating issue exists (the preflight checks this dual-path).
3. Verify the approved and done target files do not already exist.
4. Verify the user has indicated the plan is ready for approval.
5. Execute:

   ```
   mv dev-docs/plans/proposed/<id>.md dev-docs/plans/approved/<id>.md
   ```

## Stop Condition

Stop after executing the move.
Do not implement the plan.
Do not create a realized design.
Do not close anything.

## Expected Response

```
Plan approval checks passed.
Moved dev-docs/plans/proposed/<id>.md -> dev-docs/plans/approved/<id>.md
Next command:
Implement plan <id>
```
