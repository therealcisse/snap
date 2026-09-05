---
title: Working tree and everyday commands: scan, delta install, status, log, commit, diff, revert
date: 2026-09-05
author: agent
id: working-tree-and-everyday-commands
issue: working-tree-and-everyday-commands
research: []
designs:
- snap-ts-architecture
completed: 2026-09-05
closeout_notes: true
---

## Context

Issue `working-tree-and-everyday-commands` captures stack `snap-1.0`'s Working tree and everyday commands section: Snap can validate and replay a repository but cannot observe or change the working tree, and `status`, `log`, `commit`, `diff`, `revert` do not exist. This plan lands the two filesystem primitives the architecture design names (`fs/worktree.ts` scan, `fs/materialize.ts` delta install), the five command bodies, and the one-replay-per-command wiring (design decision 8). SPEC pins every observable: scan failures (§2, §10), A/M/D status (§7.3), escaped log lines (§7.4), commit change selection and limits (§7.5), unified diff rendering (§7.6), additive revert (§7.7), and mutation ordering (§10). Thirteen acceptance suites (03–08, 15, 19, 23, 25, 29, 30, 32) first fail inside this strand today.

## Current State

- Baselines: `./verify --lang ts` — 5 green (01 init, 02 init-paths, 14 cli-errors, 24 cli-grammar, 27 history-canonicality), 27 red. In-strand red: 03 (step 7 `commit local-wins`), 04–08, 15, 19 (step 4 `commit one`), 23, 25 (step 7 `commit duplicate-config`), 29, 30, 32 — each first failing at `snap: not implemented: status|commit|diff`. The other 14 red suites (09–13, 16–18, 20–22, 26, 28, 31) fail inside the merge, HTTP, and terminal-presentation strands. `cd ts && npm run check` green: 322 tests / 58 suites.
- `ts/src/cli/main.ts:74-92` — `status`/`log`/`commit` stubs locate the repository then throw `not implemented`; `diff` validates both version operands then stubs; `revert` validates its operand then stubs.
- `ts/src/fs/locate.ts` — `nearestRepository`, `findRepositoryRoot`, `loadRepository` (decode only; no command runs `validateRepository` yet), `resolveContributorId` (§8 local-over-global), config codec.
- `ts/src/repo/` — `model.ts` (decode/encode, `resultVersion`, `knownVersionKeys`), `validate.ts` (`validateRepository` → `ReplayResult`), `replay.ts` (linear replay; `ReplayResult = {tree, warnings}` — the integration sequence is internal), `tree.ts` (`Tree`, `sortedPaths`, `ancestorPaths`, `assertPrefixFree`).
- `ts/src/text/diff.ts` — `diffTokens(old, new)` (§5, coalesced) ready for commit edit scripts and diff rendering; `core/bytes.ts` has `compareBytes`, `isText`, `encodeBase64`, `isValidTrackedPath`.
- Missing entirely: `fs/worktree.ts`, `fs/materialize.ts`, `commands/{status,log,commit,diff,revert}.ts`.
- Suite-pinned bytes this plan must hit exactly: `snap: unsupported working tree entry: <path>` / `snap: invalid working tree path: <path>` with the byte-order-least offender across both classes (tests/08, tests/29); `version <v>` + `A|M|D <path>` rows in byte order — `nested/file` < `z` < `é` < `😀` (tests/04, tests/25); log escapes backslash, tab, LF in that order (tests/04:84); `snap: working tree is clean` (tests/04:96); `snap: invalid commit message` (tests/25:130); `@@ -1,<n> +1,<m> @@` whole-file blocks, `/dev/null` absent sides, `\ No newline at end of file`, `Binary files a/x and b/x differ` (tests/05, tests/06); `revert to <version>` messages, `snap: target tree is already current`, `snap: working tree is dirty` (tests/07); `status` run from a subdirectory of the root (tests/19:28); root `.snap` exclusion and empty-directory ignorance (tests/25:87–98).

## Developer Feedback

Interview skipped: SPEC pins each behavior, design `snap-ts-architecture` locks the module homes, and the suites pin the exact bytes — the issue's boundary plus these force every choice. Recorded plan-author calls:

1. **One plan, not a split.** All five bodies share the one-replay loader and the scan; commit, diff, and revert share the tree-delta and §5 edit-script machinery; revert reuses commit's change selection and install. Rejected: two plans (scan/status/log, then commit/diff/revert) — the second would depend on helpers landed by the first anyway and doubles review cycles.
2. **Shared loading extends `fs/locate.ts`** with `loadValidatedRepository(startDir): { root; repository; tree; warnings }` — locate already owns repository loading; validation is what makes a load usable. Rejected: a new `commands/context.ts` (the design's file list is closed); five per-command compositions.
3. **`ReplayResult` gains the integration sequence.** §7.4's log needs reverse canonical integration order; the linear replay loop already computes it. Rejected: log re-deriving a topological sort (duplicates §6.1).
4. **Tree comparison lives in `repo/tree.ts`**: `diffTrees(old, new)` yielding per-path `{path, old?, new?}` records sorted by path — one helper behind status's A/M/D, commit/revert's change selection, and diff's path set. Rejected: three private implementations drifting on ordering.
5. **Change selection is exported from `commands/commit.ts`** (`selectChanges(delta): Change[]`, the §7.5 text/put/delete rule) and reused by `revert.ts`. Rejected: a new `commands/changes.ts` (closes the design's module list); rejected: `repo/` (it authors command-made changes, not tree facts).
6. **Check orders follow the spec sentence order**: commit resolves contributor configuration before scanning (§7.5 — tests/25:34 pins the config error surfacing while the tree is dirty); revert checks configuration, then clean tree, then known target (§7.7). This moves today's version pre-check in `cli/main.ts` into `commands/{diff,revert}.ts`. No suite pins a conflicting order.
7. **Log performs no working-tree scan** — a pure history view; §2 only says read-only commands *may* inspect a dirty tree. No suite drives `log` against scan failures.
8. **Scan collects every offender, then reports the byte-order-least** — never the first per-directory encounter (tests/29: `a.txt` must beat `a/b`; `m-link` beats `z\x`). Directories are traversed, never path-validated; only file relative paths are checked with `isValidTrackedPath`.
9. **`diff --repo` remains `not implemented`** — the HTTP operand is the HTTP strand (issue Out of Scope).
10. **Message and overflow failures**: `invalid commit message` covers empty, disallowed control characters, and >4096-UTF-8-byte messages (tests/25 pins the empty case; §7.5 groups the rest); revision past `9007199254740991` fails with `revision overflow` (unpinned text; practically unreachable, checked anyway). Revert's generated message is exempt from the 4096 limit (§4.2).

## Approach

1. **`fs/worktree.ts`** — `scanWorkingTree(root: string): Tree`. Recursive `readdirSync(dir, { withFileTypes: true })`; the root `.snap` directory is skipped (only at the root — `sub/.snap/x` stays tracked, per `isValidTrackedPath`); directories recurse; regular files are read as `Uint8Array` and recorded under their `/`-joined relative path; every other dirent (symlink, FIFO, socket, device) records an `unsupported` offender. Each file's relative path is checked with `isValidTrackedPath` (`invalid` offender). After the full traversal, the offender with the byte-order-least relative path throws `SnapError` with its §10 message; an offender-free scan returns the `Tree`.
2. **`repo/tree.ts`** — add `interface TreeChange { readonly path: string; readonly old: Uint8Array | undefined; readonly new: Uint8Array | undefined }` and `diffTrees(oldTree: Tree, newTree: Tree): TreeChange[]` (paths of either tree whose bytes differ, `compareBytes`-sorted).
3. **`fs/locate.ts`** — add `loadValidatedRepository(startDir)` returning `{ root, repository, tree, warnings }` from `findRepositoryRoot` + read/decode + `validateRepository`. Every command in this plan calls it exactly once (design decision 8).
4. **`repo/replay.ts`** — `ReplayResult` gains `sequence: readonly Patch[]` (integration order); the ready-set loop appends each winner. Add `materializeVersion(repository: Repository, version: Version): Tree` — selects patches `(c, n)` with `n <= version[c]` and replays that subset through the same loop (linear histories: the subset is a causal prefix chain); used by `diff <old> <new>` and `revert`.
5. **`fs/materialize.ts`** — `installTree(root: string, current: Tree, target: Tree): void` per §6.2's closing paragraph and §10: first remove current files that block required directories (a target path's ancestor present as a file), then delete removed paths, prune newly empty directories bottom-up (`rmdirSync` up the ancestor chain, `ENOTEMPTY`/`ENOENT` swallowed), create required parent directories (`mkdirSync recursive`), write target files. `writeRepository(root: string, text: string): void` writes `repository.json` through a same-directory temporary file + `renameSync`. Working files before metadata, always (§10).
6. **`commands/status.ts`** — `status(cwd: string): CommandOutput`: load/validate → `scanWorkingTree` → `diffTrees(tree, working)` → `version ${formatVersion(repository.frontier)}\n` then one `${A|M|D} ${path}\n` row per change (A: old absent; D: new absent; M: both present, bytes differ).
7. **`commands/log.ts`** — `log(cwd: string): CommandOutput`: reverse `sequence` → one line per patch: `${formatVersion(resultVersion(patch))}\t${patch.author}\t${escapeMessage(patch.message)}\n`, with `escapeMessage` replacing `\` → `\\`, then tab → `\t`, then LF → `\n` (§7.4 order).
8. **`commands/commit.ts`** — `commit(message: string, cwd: string, env): CommandOutput`: load/validate; `resolveContributorId(root, env)` (missing → `contributor.id is required; configure it locally or globally`); message rules (`invalid commit message` for empty, a control character other than tab/LF, or `encodeUtf8(message).length > 4096`); `scanWorkingTree`; `diffTrees`; empty delta → `working tree is clean`; otherwise one patch — base `repository.frontier`, revision `componentOf(frontier, id) + 1` (beyond `9007199254740991` → `revision overflow`), changes via exported `selectChanges` (delete when new absent; `text` with `diffTokens(tokenize(old), tokenize(new))` when new is text and old is absent or text; otherwise `put` with `encodeBase64`), message verbatim; new repository = old + patch with `frontier = resultVersion(patch)`; `writeRepository` (metadata only — the files are already on disk, §10). Output `${formatVersion(newVersion)}\n`.
9. **`commands/diff.ts`** — `diff(oldVersion: string, newVersion: string, repo: string | undefined, cwd: string): CommandOutput`; `repo !== undefined` stays `not implemented` (call 9). Both forms validate before output (§7.6): the two-version form parses and known-checks each operand (`invalid version: <text>` / `unknown version: <text>`; tests/19, tests/25) and compares `materializeVersion(old)` with `materializeVersion(new)`; the working-tree form is `diffTrees(tree, scanWorkingTree(root))`. Rendering is private: for each `TreeChange` in path order — if old and new are each absent or text, one whole-file block: `--- a/<path>` or `--- /dev/null`, `+++ b/<path>` or `+++ /dev/null`, `@@ -1,<oldTokens.length> +1,<newTokens.length> @@`, then the §5 script over `tokenize` of both sides with retained lines prefixed ` `, deleted `-`, inserted `+`, and `\ No newline at end of file` after any rendered token lacking a final LF; otherwise one line `Binary files <a/<path>|/dev/null> and <b/<path>|/dev/null> differ`. No differences → empty stdout, success (tests/05:117).
10. **`commands/revert.ts`** — `revert(version: string, cwd: string, env): CommandOutput`: load/validate; contributor configuration (§8 error); `scanWorkingTree`; any delta → `working tree is dirty`; parse + known-check the target; `target = materializeVersion(...)`; `diffTrees(tree, target)` empty → `target tree is already current`; otherwise author one patch like commit but with message `revert to ${formatVersion(targetVersion)}` (exempt from 4096, §4.2) and `selectChanges` changes; `installTree(root, tree, target)` then `writeRepository`; output the new version.
11. **`cli/main.ts`** — dispatch the five commands to their functions (drop the status/log/commit stubs; `diff` with `--repo` set, `merge`, and `serve` keep `notImplemented`); `requireKnownVersion` moves into `commands/{diff,revert}.ts` (call 6).
12. **Unit tests** colocated per module: scan offender rules (incl. `a.txt` vs `a/b`, `m-link` vs `z\x`, root `.snap` skip, empty-dir ignorance); `diffTrees` goldens; install transitions both directions with pruning; atomic repository write; command-level tests in tmp directories pinning every message and golden listed in Current State (the YAML suite remains the acceptance criterion; unit tests pin the same bytes at Node speed).

## Tasks

- [ ] `ts/src/fs/worktree.ts` + `worktree.test.ts`: `scanWorkingTree` — withFileTypes traversal, root `.snap` skip, offender collection with byte-order-least reporting across classes, empty directories ignored, byte round-trip, byte-order iteration.
- [ ] `ts/src/repo/tree.ts` + `tree.test.ts`: `TreeChange`, `diffTrees` (A/M/D triples, equal paths excluded, byte order).
- [ ] `ts/src/fs/locate.ts` + `locate.test.ts`: `loadValidatedRepository` returning `{root, repository, tree, warnings}`; decode/validate error pass-through.
- [ ] `ts/src/repo/replay.ts` + `replay.test.ts`: `sequence` in integration order; `materializeVersion` — frontier equality, earlier-version subset, `()` → empty tree.
- [ ] `ts/src/fs/materialize.ts` + `materialize.test.ts`: `installTree` file→directory and directory→file transitions, blocking-file removal, empty-directory pruning without touching still-needed parents, no-op on equal trees; `writeRepository` — exact bytes, same-directory temp + rename.
- [ ] `ts/src/commands/status.ts` + `status.test.ts`: version line + A/M/D rows byte-ordered; clean output; scan failure messages.
- [ ] `ts/src/commands/log.ts` + `log.test.ts`: reverse integration order; escape order `\`, tab, LF (tests/04:84 golden).
- [ ] `ts/src/commands/commit.ts` + `commit.test.ts`: `selectChanges` export (text/put/delete incl. binary side → put, empty file → empty text edit); message rules; missing contributor; clean-tree refusal; resulting `repository.json` shape (tests/05:63 golden); version output.
- [ ] `ts/src/commands/diff.ts` + `diff.test.ts`: both forms byte-identical on identical trees (tests/05); `/dev/null` sides; header counts incl. `0`; no-newline marker placement; binary line both directions; equal versions → empty; version validation errors.
- [ ] `ts/src/commands/revert.ts` + `revert.test.ts`: additive patch + `revert to <version>` message; install restores transitions (tests/07 file asserts); `target tree is already current`; `working tree is dirty`; contributor-required path.
- [ ] `ts/src/cli/main.ts` + `main.test.ts`: wire the five commands; `--repo` diff, `merge`, `serve` remain `not implemented`; version checks move into command bodies.
- [ ] `cd ts && npm run format && npm run check` green.
- [ ] `./verify --lang ts`: 01–08, 14, 15, 19, 23, 24, 25, 27, 29, 30, 32 green (18 suites); 09–13, 16–18, 20–22, 26, 28, 31 still red in their own strands.

## Documentation Impact

None. `ts/AGENTS.md` Layout already names `fs/` (locate, worktree, materialize) and one file per command; no CLI-visible behavior beyond the spec'd commands this plan implements. Stack checklist updates happen via `Update stack` / `Close issue`, not here.

## Acceptance Tests

- `cd ts && npm run check` green (growing from 322 tests / 58 suites), with unit tests asserting every pinned fragment: `unsupported working tree entry:`, `invalid working tree path:`, `working tree is clean`, `invalid commit message`, `contributor.id is required; configure it locally or globally`, `target tree is already current`, `working tree is dirty`, `unknown version:`, `invalid version:`.
- `./verify --lang ts` from the repository root: exactly 18 suites pass — 01–08, 14, 15, 19, 23, 24, 25, 27, 29, 30, 32; the 14 suites 09–13, 16–18, 20–22, 26, 28, 31 still fail, each first-failing inside its own strand, none at `not implemented: status|commit|diff`.
- Byte-level spot checks mirrored from the suites: unicode status ordering; the log escape golden `first\tline\nsecond\\tail`; tests/05 and tests/06 diff goldens verbatim; tests/07's revert `log` history.
