# Close Issue (Interactive)

Closes an open issue after all plans are done and designs are approved. Runs a closeout review (docs, stacks, AGENTS.md), records closeout notes, then hands the human the gated final close. The issue may live in the tracker (Linear) or as a local file in `dev-docs/issues/open/`. In both cases the close is human-gated: the agent prepares everything but does not perform the final close. See `dev-docs/harness/tracker.md` and `.agents/skills/linear/SKILL.md`.

<HARD-GATE>
Do not create commits. Do not modify approved, done, or closed artifacts. Do not set the tracker issue to Done (human-gated).
</HARD-GATE>

## Operational Directives

### Allowed Actions

- Record closeout notes: for a Linear issue, post them as a tracker comment via `scripts/linear.sh comment <id>`; for a local issue, add `closed:` frontmatter to the open file.
- `dev-docs/stacks/<name>.md`, only if the issue has a `stack` field.
- Root `AGENTS.md`, only if the proposed change passes `dev-docs/harness/agents-policy.md`.
- Subdirectory `AGENTS.md` files, only if the proposed change passes `dev-docs/harness/agents-policy.md`.
- `README.md`, only for current overview corrections.
- Relevant `GUIDELINES.md` files, only for durable local guidance corrections.

### Forbidden Writes

- Product code.
- Tests.
- `dev-docs/plans/approved/`
- `dev-docs/plans/done/`
- `dev-docs/issues/closed/` (the human performs the close move; the agent only prints it).
- `dev-docs/designs/approved/`
- New plans.
- New designs.
- Moving the tracker issue to Done. The agent never sets Done; it prints the deep-link for the human.

## Checklist

1. **Resolve issue id + store** -- use the given id or infer from context; detect tracker vs local
2. **Verify preconditions** -- run preflight, confirm all plans done and designs approved
3. **Record closeout notes** -- tracker comment (Linear) or `closed:` frontmatter (local)
4. **Update stack** -- if the issue has a `stack` field, check off satisfied items
5. **Review documentation** -- check AGENTS.md, README, GUIDELINES for staleness
6. **Confirm and hand off** -- present summary, get confirmation, hand the human the gated close

## Step 1. Resolve Issue Id and Store

If the user provided an issue id, use it.

Detect the store:
- If `dev-docs/issues/open/<id>.md` exists, the issue is **local** (file-based).
- Otherwise the issue is in the **tracker** (Linear); Step 2 confirms it exists there.

Read the issue content for the closeout review: the local file directly, or `scripts/linear.sh fetch <id>` for a tracker issue.

If no id was provided:
- List non-example `.md` files in `dev-docs/issues/open/` and run `scripts/linear.sh list open`.
- If exactly one open issue exists across both, use it.
- If zero or multiple exist, report the candidates and ask for the issue id.

## Step 2. Verify Preconditions

Read these files (skip if already in context):

- `AGENTS.md`
- `dev-docs/harness/agents-policy.md`
- The issue content (local file, or `scripts/linear.sh fetch <id>` for a tracker issue)
- All related plans in `dev-docs/plans/done/`
- All related approved realized designs in `dev-docs/designs/approved/`

Run `scripts/dev-docs-preflight.sh close-issue <id>`. The gate is dual-path: it confirms the issue exists in the tracker or as a local file and is not already in a terminal state. If the gate fails, stop and report.

Verify:
- All related plans are in `dev-docs/plans/done/`.
- All related realized designs are in `dev-docs/designs/approved/`.

If any check fails, report what is missing and suggest the next command.

## Step 3. Record Closeout Notes

The closeout notes capture the close date and a one-line outcome of the doc review.

**Local issue:** add `closed:` frontmatter to `dev-docs/issues/open/<id>.md`:

```yaml
closed: YYYY-MM-DD
```

**Tracker (Linear) issue:** post a closeout comment so the record is durable in the tracker. Pipe the body to `scripts/linear.sh comment <id>`. Use:

```
Closeout: YYYY-MM-DD.

<Doc-review outcome: what changed, or "no doc changes needed". Include the stack note if applicable.>
```

Do not set the issue to Done here; the human does that in Step 6.

## Step 4. Update Stack

If the issue names a stack (local `stack:` frontmatter, or the `**Stack:** <name>` line in a Linear issue body):

1. Read `dev-docs/stacks/<name>.md`.
2. Analyze implementation state against the stack.
3. Check off all stack items now satisfied by the code.
4. Do not uncheck items.

Present the updated stack to the user for review.

## Step 5. Review Documentation

This is the closeout sweep. Check the following for staleness, omissions, inconsistencies, and bloat introduced by the completed work:

**AGENTS.md files:**
- Root `AGENTS.md`.
- Relevant subdirectory `AGENTS.md` files.
- For every proposed change, classify using `dev-docs/harness/agents-policy.md`. Only make changes that pass the classification gate.
- Use the classification template for each change:

```
## AGENTS.md Change Classification
- File:
- Proposed change:
- Category:
- Why this belongs in AGENTS.md:
- Why this does not belong in README, spec, issue, plan, design, stack, harness command, or skill:
- Expected durability:
```

If the change cannot be justified, do not make it.

**README.md:** Check root and relevant subdirectory READMEs for current overview corrections.

**GUIDELINES.md:** Check relevant files for durable local guidance corrections.

**Route non-AGENTS changes** to the appropriate artifact (README, GUIDELINES, stacks, specs, plans, designs, or skills).

Present all proposed documentation changes to the user before making them. Ask:

> Here are the documentation changes I want to make. Do any of these look wrong, or should I proceed?

## Step 6. Confirm and Hand Off

After all updates are made, present the closeout summary:

```
Issue close checks passed.
Recorded closeout notes on: <local file, or Linear issue <id>>
Updated:
- `dev-docs/stacks/<name>.md` (if applicable)
Documentation review:
- AGENTS.md: <what changed, or "no changes needed">
- README.md: <what changed, or "no changes needed">
- GUIDELINES.md: <what changed, or "no changes needed">
```

Ask for confirmation:

> Ready to close this issue?

The close is human-gated; the agent does not perform the final move. On confirmation (or when the conversation context already implies intent to close):

**Local issue:** print the move command for the human to run:

```bash
mv dev-docs/issues/open/<id>.md dev-docs/issues/closed/<id>.md
```

**Tracker (Linear) issue:** print the issue's deep-link (from `scripts/linear.sh find-by-id <id>`) for the human to set Done in Linear:

```
Set Done in Linear: <url>
```

Report the handoff. Do not run the `mv`, and do not set Done.

## Stop Condition

Stop after handing off the gated close.
Do not create commits unless explicitly asked.
Do not start a new issue.
Do not create a new plan.

## Key Principles

- **Human gates the close** -- the agent prepares the closeout but does not perform the final close (no `mv`, no setting Done). Print the gated move for the human.
- **Docs review is interactive** -- present proposed AGENTS.md, README, and GUIDELINES changes to the user before making them.
- **Stack update is part of closeout** -- check off satisfied items in the related stack.
- **Classify every AGENTS.md change** -- use `agents-policy.md` to prevent bloat.
- **No commits** -- the user decides when to commit.
- **Project-agnostic** -- this skill references only root `AGENTS.md` and files under `dev-docs/`.
