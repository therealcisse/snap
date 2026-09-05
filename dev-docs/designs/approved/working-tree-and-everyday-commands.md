---
title: Working tree and everyday commands: scan, delta install, status, log, commit, diff, revert — realized
date: 2026-09-05
author: agent
id: working-tree-and-everyday-commands
issue: working-tree-and-everyday-commands
plan: working-tree-and-everyday-commands
---

## Summary

Snap can now observe and change the working tree: a byte-exact scan with §10 failure selection, a delta installer with §10 mutation ordering, and the five everyday commands (`status`, `log`, `commit`, `diff`, `revert`) wired through one validated load per command. The acceptance landscape moved from 5 to exactly the 18 planned green suites; the merge, HTTP, and terminal strands remain red in their own scope.

## Plan Realized

### working-tree-and-everyday-commands

All thirteen tasks of `dev-docs/plans/approved/working-tree-and-everyday-commands.md` landed as specified, with the deviations recorded below (notably: the revert check order the plan recorded was corrected against tests/24; the loader returns a grouped `replay` result; two acceptance-driven additions — §6.1 least-ready selection in `repo/replay.ts` and a test-harness `remove` fix — were required to reach the planned landscape).

## Implementation

- `ts/src/fs/worktree.ts` — `scanWorkingTree(root): Tree`: recursive `withFileTypes` walk; the root `.snap` is skipped (deeper `.snap` paths stay tracked); regular files read as bytes under `/`-joined relative paths; every other dirent is an `unsupported` offender, each file's path an `isValidTrackedPath` check (`invalid` offender); after traversal the byte-order-least offender throws `SnapError('<kind>: <path>')`; empty directories ignored; tree iterates in byte order.
- `ts/src/repo/tree.ts` — added `equalBytes`, `TreeChange {path, old?, new?}`, `diffTrees(old, new)` (differing paths only, `compareBytes`-sorted).
- `ts/src/fs/locate.ts` — `loadValidatedRepository(startDir)` returns `{root, repository, replay}` (`replay` = the one `ReplayResult`: tree, warnings, sequence); decode-only `loadRepository` removed.
- `ts/src/repo/replay.ts` — `ReplayResult.sequence` records integration order; `materializeVersion(repository, version)` replays the §6.1-selected subset; the ready loop now implements §6.1's least-ready choice (Snap order of result versions, then author bytes, then revision) and refuses with `concurrent replay is not implemented yet` only when the winner's base is strictly before the integrated version.
- `ts/src/repo/model.ts` — added `resolveKnownVersion` (parse + `knownVersionKeys` → `unknown version: <text>`) and `withPatch` (sorted `(author, revision)` insertion).
- `ts/src/fs/materialize.ts` — `installTree(root, current, target)` (blocking-file removal → deletes → empty-directory pruning → mkdir recursive → writes) and `writeRepository` (same-dir temp + `renameSync`).
- `ts/src/commands/` — `status.ts` (version line + A/M/D rows), `log.ts` (reverse sequence, `escapeMessage` in backslash→tab→LF order), `commit.ts` (check order contributor → message → scan → clean; exports `selectChanges`, `nextRevision`, `writeRepositoryVersion`), `diff.ts` (`diffWorktree(cwd)`, `diffVersions(old, new, cwd)`; private §7.6 renderer re-deriving the §5 script via `diffTokens`), `revert.ts` (check order known-version → dirty → contributor; `installTree` then `writeRepository`).
- `ts/src/cli/args.ts` — zero-operand `diff` parses to a new `diffWorktree` command variant; `ts/src/cli/main.ts` dispatches all five bodies; `--repo` diff, `merge`, `serve` remain `not implemented` at the boundary.

## Behavior

- `status` prints `version <frontier>` then `A|M|D <path>` rows in byte order; `log` prints one `<result version>\t<author>\t<escaped message>` line per patch, newest first, without scanning the tree.
- `commit <message>` requires a configured contributor, a valid message (nonempty, ≤4096 UTF-8 bytes, no controls beyond tab/LF), and a dirty tree — in that order — then authors one patch (`text` edit via `diffTokens`, `put` for non-text bytes, `delete` for removals; empty file = empty text edit), rewrites only `repository.json`, and prints the new version.
- `diff` with no operands compares the replay tree with a fresh scan; `diff <old> <new>` resolves old then new against known versions and materializes both; text changes render whole-file blocks with `/dev/null` absent sides, `@@ -1,<n> +1,<m> @@` headers, `\ No newline at end of file` markers, and `Binary files a/x and b/x differ` lines; equal trees produce empty stdout.
- `revert <version>` refuses unknown versions before touching configuration or the tree, then requires a clean tree and a contributor, materializes the target, refuses equal trees with `target tree is already current`, else authors one additive patch (`revert to <version>`), installs working files first, then metadata, and prints the new version.
- All scan failures throw the byte-order-least offender across both classes; every expected error exits 1 as `snap: <detail>`.

## Tests

- Unit (node:test, colocated): `fs/worktree.test.ts`, `fs/materialize.test.ts`, `fs/locate.test.ts`, `repo/tree.test.ts`, `repo/replay.test.ts`, `commands/{status,log,commit,diff,revert}.test.ts`, updated `cli/{args,main}.test.ts` — `cd ts && npm run check` green at 364 tests / 73 suites (from 322/58), pinning every suite-pinned message and golden at Node speed.
- Harness regression: `test-harness/test/harness.test.ts` gains "runner removes a dangling symlink"; harness gate green (11 tests).
- Acceptance: `./verify --lang ts` — exactly the planned 18 green suites (01–08, 14, 15, 19, 23, 24, 25, 27, 29, 30, 32); the 14 merge/HTTP/terminal suites still fail first inside their own strands.

## Decisions

- **Revert checks known-version first** — plan call 6 recorded "configuration, clean, known", but tests/24 pins `revert (unknown@x->1)` with no contributor configured printing `unknown version`; the implemented order is known-version → dirty → contributor.
- **Loader returns one grouped replay** — `{root, repository, replay}` keeps the one-replay-per-command invariant (architecture decision 8) and gives `log` the sequence without re-deriving §6.1 order.
- **`withPatch` inserts sorted** — appending breaks §4.1 patch sortedness on multi-author histories; a commit.test.ts case pins the insertion point.
- **§6.1 least-ready selection landed now** — tests/23's strict-validation step has two patches based on `()` and expects the §4.5 `delete of absent path: f` surfaced from the Snap-least one; the interim §6.2 refusal now fires only when the selected winner's base is strictly behind the integrated version, which is the true merge territory.
- **Harness `remove` fixed with `unlinkSync`** — node v24.9 on macOS leaves dangling symlinks in place under `rmSync` (recursive or not), which made tests/08 and tests/29 unpassable for any candidate; non-directories are now unlinked, with a harness regression test.
- **`--repo` refusal stays at the CLI boundary** — `diffVersions` never sees a repository operand; the boundary already speaks the pinned `not implemented: diff … --repo …` line.
- **Diff rendering re-derives the §5 script** — displayed lines and committed edits come from the same `diffTokens` call, so they can never disagree.
- **Commit writes metadata only** — the working files are already on disk; §10's working-files-first ordering matters only for revert's `installTree` → `writeRepository` sequence.
- **Revert's generated message skips `validateMessage`** — the 4096-byte limit applies to user-supplied commit messages only (§4.2); the generated `revert to <version>` is exempt by construction.

## Follow-Up

- The merge strand replaces the interim §6.2 refusal; `readyOrder` already provides §6.1's selection, so concurrent integration starts from a correct baseline.
- `installTree`, `writeRepository`, `selectChanges`, `nextRevision`, and `writeRepositoryVersion` are the shared substrate for `merge`'s dirty-tree refusal and patch authoring.
- The macOS `rmSync`-dangling-symlink quirk is documented in `test-harness/src/filesystem.ts` and pinned by its regression test; worth knowing if other fixtures ever need link removal.
