# Tracker Operations Contract

The Janus issue lifecycle stores issues in an external tracker (Linear today) rather than per-worktree markdown, so issue state is shared across all worktrees. This document is the stable operations contract every tracker backend must implement. The workflow skills and `scripts/dev-docs-preflight.sh` depend only on this surface, so the backend is swappable: replace the implementation, repoint the skill, and the call sites are unchanged.

The current implementation is `scripts/linear.sh`, documented by `.agents/skills/linear/SKILL.md`.

## Operations

A backend is a single entry point script that takes a command and implements these subcommands. Subcommand names and exit-code semantics are fixed; that is what makes the call sites stable.

- `id-in-use <janus-id>`: exit 0 if the id is taken (any state), exit 1 if free. Diagnostics to stderr.
- `find-by-id <janus-id>`: print the resolved issue's stable fields (tracker id, identifier, state, title, url) on stdout. Exit 0 found, 1 missing, 2 ambiguous. Ambiguity is an error, not a guess.
- `create-issue <janus-id> <title>`: read the description body from stdin, create the issue carrying the janus id (current backend stores it as `[<id>]` in the title), in the backlog state, and print the new issue's identifier, url, and state.
- `set-state <janus-id> <backlog|open|done|canceled>`: move the issue to the corresponding lifecycle state.
- `comment <janus-id>`: read the body from stdin and append it as a comment on the issue.
- `fetch <janus-id>`: print one issue as markdown to stdout, including its description and comments. The canonical read-by-id path.
- `sync`: materialize every project issue as markdown into the shared read-only cache, atomically, and drop stale entries. On-demand, never eager.
- `list [lifecycle-state]`: print `janus-id|identifier|state|title` for every issue that carries a janus id. Pass a lifecycle word (`backlog|open|done|canceled`) to filter.

## Rules

- **State and existence are always live.** `id-in-use` and `find-by-id` query the tracker on every call. The materialized cache is never used for gate decisions. A stale cache can affect content grep only, never gate correctness.
- **The cache is read-only.** The shared cache (default `~/.cache/janus/issues/`, configurable) lives outside the repo so one copy serves every worktree. Agents read and grep it for context. They never edit it and it is never the source of truth.
- **Agents never source-of-truth the cache.** `sync` rebuilds it from the tracker. If the cache and the tracker disagree, the tracker wins.
- **Human gates Done.** close-issue never sets Done itself. It prints the issue's tracker deep-link and the human completes the move in the UI, preserving the close-issue human gate.

## Lifecycle states

The contract uses four lifecycle words: `backlog`, `open`, `done`, `canceled`. A backend maps these to its native workflow states. The current Linear mapping: backlog to Backlog, open to In Progress (the active work state), done to Done, canceled to Canceled.

The backlog may hold any number of captured issues across both stores; the tracker backend stays stateless.

## Id model

The stable kebab-case Janus id is the key the rest of the system uses. The backend stores it on the issue and parses it back for resolution. Plans and designs reference issues by this id in their `issue:` frontmatter. The tracker's own identifier (for example `THE-5`) is a convenience for deep-links, not the reference key.

## Coexistence model (dual-path)

Issues live in one of two peer stores: the tracker (Linear) or local `dev-docs/issues/{backlog,open,closed}/`. Both are first-class and permanent. id-resolution, id-uniqueness, and issue-existence checks are dual-path at the preflight and skill layer: a hit in the tracker OR in local `dev-docs/issues/` passes, so a local issue is fully plannable and closeable. Context grep spans both the cache and local `dev-docs/issues/`.
