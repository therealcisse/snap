# Linear (tracker backend)

Tracker backend skill for the Janus dev-docs issue lifecycle. This is the seam that makes the issue tracker swappable: the workflow skills (`/new-issue`, `/close-issue`, the plan/design skills) and `scripts/dev-docs-preflight.sh` talk to the issue tracker only through `scripts/linear.sh`, never to Linear's API directly. Replacing the tracker means writing a new backend script that implements the same operation surface and repointing this skill, not rewriting the workflow skills.

The tracker-agnostic contract lives in `dev-docs/harness/tracker.md`. This skill is the concrete Linear implementation.

## Backend script

`scripts/linear.sh` is a bash plus curl plus jq helper over `$LINEAR_API_KEY`. It implements every operation in the contract. Run `scripts/linear.sh --help` for the command list.

## Operations

Every command hits Linear live (see Rules). Arguments after the command name are positional.

- `id-in-use <janus-id>`: exit 0 if an issue with that id exists in any state, exit 1 if the id is free. Diagnostics print to stderr. Used by id-uniqueness preflight (wrapped dual-path at the caller).
- `find-by-id <janus-id>`: print `linear_id`, `identifier`, `state`, `title`, `url` lines on stdout. Exit 0 when found, 1 when missing, 2 when ambiguous (two issues share the id). Errors loudly on ambiguity because Linear titles are not unique.
- `create-issue <janus-id> <title>`: read the issue description (markdown body) from stdin, create the issue with title `[<janus-id>] <title>` in the backlog state, print `created:`, `url:`, `state:` lines.
- `set-state <janus-id> <backlog|open|done|canceled>`: map the lifecycle word to the Linear workflow state and move the issue. Print the resulting identifier and state. Note: `done` exists for completeness and parity, but close-issue does not use it (see Rules).
- `comment <janus-id>`: read the comment body from stdin and append it as a Linear comment. Used by close-plan to attach closeout notes to a Linear issue.
- `fetch <janus-id>`: print one issue as markdown to stdout (frontmatter block with `janus_id`, `linear_id`, `state`, `url`, `title`, then the description, then `## Comments`). Used for read-by-id context gathering.
- `sync`: materialize every Janus-project issue as markdown into the shared cache, atomically (temp file plus rename per issue), and remove stale cache entries no longer present in the tracker. On-demand, not eager.
- `list [lifecycle-state]`: print `janus-id<TAB>identifier<TAB>state<TAB>title` for every issue that carries a janus id. Pass a lifecycle word (`backlog|open|done|canceled`) to filter; omit it to list all.

## Rules

- **Live, not cached.** State and existence checks (`id-in-use`, `find-by-id`) always query Linear. The shared cache is never consulted for gate decisions, so cache staleness affects only content grep, never gate correctness.
- **Cache is read-only materialization.** The cache lives at `~/.cache/janus/issues/` (configurable via `JANUS_ISSUE_CACHE_DIR`), outside every worktree so one copy serves all. Agents read and grep it for context; they never edit it and it is never the source of truth.
- **Go through the script.** Workflow skills and the preflight call `scripts/linear.sh`. They never call the Linear GraphQL API directly. That isolation is the whole point of the seam.
- **Human gates Done.** The agent never moves an issue to Done itself. close-issue prints the issue's Linear deep-link and the human sets Done in the UI, preserving the existing human gate. `set-state ... done` is not used by close-issue.

## Configuration

Environment variables (all optional except `LINEAR_API_KEY`; defaults shown):

- `LINEAR_API_KEY` (required): personal Linear API key. Get it from Linear under Settings, API, Personal API keys.
- `JANUS_LINEAR_TEAM_KEY` (default `THE`): the team key to scope issues to.
- `JANUS_LINEAR_PROJECT` (default `Janus`): the project name to scope issues to. Janus issues live in this project for clean isolation.
- `JANUS_LINEAR_BACKLOG_STATE` (default `Backlog`), `JANUS_LINEAR_OPEN_STATE` (default `In Progress`), `JANUS_LINEAR_DONE_STATE` (default `Done`), `JANUS_LINEAR_CANCELED_STATE` (default `Canceled`): the Linear workflow-state names the lifecycle words map to. `open` maps to In Progress, the active work state.
- `JANUS_ISSUE_CACHE_DIR` (default `~/.cache/janus/issues`): the shared read-only cache directory.
- `LINEAR_API_ENDPOINT` (default `https://api.linear.app/graphql`): the GraphQL endpoint.

Team, project, and workflow states are resolved by name at runtime (the script looks them up and caches the ids per process), so the same script works across environments without hardcoded uuids.

## Id model

The stable kebab-case Janus id is stored in the Linear issue title as `[<id>] <title>`. The backend parses it back out of the title to resolve `find-by-id` and friends. This preserves every existing cross-reference-by-id in the repo (plans and designs carry `issue: <id>` frontmatter) and needs no paid Linear features. The Janus id is the key the rest of the system uses; the Linear identifier (for example `THE-5`) is surfaced only as a convenience for deep-links.

## Lifecycle mapping

- Janus `backlog` maps to Linear Backlog (the captured, not-yet-opened intake state).
- Janus `open` maps to Linear In Progress (the active work state).
- Janus `done` (closed) maps to Linear Done.
- Janus `canceled` maps to Linear Canceled.

A janus id counts as in use regardless of state, so closed and canceled ids are not reusable, matching the old closed-directory immutability rule.
