---
title: Merge command: dot-keyed import, joined replay, and the warning difference — realized
date: 2026-09-05
author: agent
id: snap-merge-command
issue: snap-merge-command
plan: snap-merge-command
---

## Summary

Snap now has its eighth everyday command. `snap merge <repository>` (SPEC §7.8, §10) resolves the operand — a local path to a repository root, or an `http(s)://` URL fetched by the strict §9 client — unions the two histories dot-keyed with collision detection, replays the joined history canonically, installs the working-tree delta, rewrites `repository.json`, prints the joined version on stdout, and prints the §6.4 new-warnings difference on stderr. The three seams the sibling plan `cross-repository-diff` consumes landed exactly as that plan specifies: `assertNoPatchCollisions` in `repo/validate.ts`, `loadRepositoryAtRoot` in `fs/locate.ts`, and the async `execute` seam in `cli/main.ts`. One unplanned change: version knownness in `repo/model.ts` was rewritten from an enumerated key set to a semantic `isKnownVersion` check — tests/21 step 19 exposed the old check rejecting merged frontiers that SPEC §1.1/§7.6 define as known.

## Plan Realized

### snap-merge-command

All eight tasks of `dev-docs/plans/approved/snap-merge-command.md` landed. Deviations from the plan's approach:

- **Knownness rewrite (the substantive one).** tests/21 step 19 (merge, then `diff` against the merged frontier) exposed that `repo/model.ts` decided knownness with `knownVersionKeys` — the set of patch result versions plus `()` — so a merged frontier like `(a@x->2,b@x->2)` failed `resolveKnownVersion` even though it is reproducible from the empty tree plus the stored patches (SPEC §1.1 invariant 4, §7.6). Replaced with `isKnownVersion(repository, version): boolean`: every named dot exists as a patch, and every selected patch (`componentOf(version, author) >= revision`) has a base causally ≤ the version. `resolveKnownVersion` — shared by `diff` and `revert` — now calls it; `knownVersionKeys` is removed. No SPEC change: the spec was already correct; tests/21 is the pinned regression.
- **`loadRepositoryOperand` is an `async function`**, not a sync function returning a promise: the local-path arm's load errors would otherwise throw synchronously before any promise existed (unit tests caught this); `async` makes both arms reject uniformly through `execute`'s await.
- **Lint forced a `union.ts` restructure.** `non-nullable-type-assertion-style` bans the sketched `as Patch` cast under `noUncheckedIndexedAccess`, and the repo bans `!` outside tests — the merge-walk instead guards `while (i < local.length && j < remote.length)` and appends the remainder with `slice`. No behavior change.

## Implementation

- `ts/src/repo/validate.ts` — exported `assertNoPatchCollisions(local, remote): void` (reserved for the union; `validateRepository` untouched). Per side builds `author → revision → encodePatch(patch)` maps; every dot present in both must be structurally equal; the first difference in (author bytes, then revision) order throws `patch collision: <author> revision <n>`. `encodePatch` is the §4.2 identity, so key-order-only differences pass. Private `dotKey` helper.
- `ts/src/fs/locate.ts` — `loadRepositoryAtRoot(root): LoadedRepository` reads `<root>/.snap/repository.json`, decodes, validates (one replay in the `LoadedRepository`); unreadable → `not a Snap repository`. `loadValidatedRepository(startDir)` becomes the nearest-walk wrapper: `findRepositoryRoot` then delegate.
- `ts/src/commands/operand.ts` — `async loadRepositoryOperand(operand, cwd): Promise<Repository>`: `http://`/`https://` prefix → `fetchRepository(operand)`; otherwise `loadRepositoryAtRoot(resolve(cwd, operand)).repository`. The URL form has no root, so the return is the validated `Repository` alone.
- `ts/src/repo/union.ts` — `unionRepositories(local, remote): Repository`: `assertNoPatchCollisions` first, then a merge-walk of the two patch arrays (each already `(author bytes, revision)`-sorted) into one sorted array with structurally-equal duplicates collapsed, then `frontier: joinVersions(local.frontier, remote.frontier)`. `compareDots` compares author bytes, then revision with explicit `<`/`>`.
- `ts/src/commands/merge.ts` — `merge(operand, cwd): Promise<CommandOutput>` in the plan's §10 order: `loadValidatedRepository(cwd)` → `await loadRepositoryOperand` → `unionRepositories` → `validateRepository(joined)` (the canonical joined replay) → `scanWorkingTree` → `diffTrees(local.replay.tree, working)` dirty check → `installTree(local.root, local.replay.tree, joinedReplay.tree)` then `writeRepository`. stdout is `formatVersion(joined.frontier) + '\n'`; stderr is the §6.4 set difference — joined replay warnings whose `path\0reason` key is absent from the local replay's, rendered `warning: auto-resolved <path>: <reason>\n` in the joined list's (path, reason) order.
- `ts/src/cli/main.ts` — `execute` is now `async` (`Promise<CommandOutput>`), `run` does `emit(await execute(...))`; the merge arm is `return merge(command.repository, ctx.cwd)`; the `findRepositoryRoot` + `notImplemented` placeholder and its import are gone.
- `ts/src/repo/model.ts` + `repo/replay.ts` — the knownness swap above. `model.ts` imports `compareVersions` and `componentOf` (drops `EMPTY_VERSION`, `versionKey`); `replay.ts`'s doc comment now references `isKnownVersion`.
- `ts/AGENTS.md` — Layout clause: command bodies may return `Promise<CommandOutput>` when the operand needs the async §9 client (`merge`); `execute` awaits. Purity is otherwise unchanged.

## Behavior

- `snap merge <path>` from inside a repository: local history loads and replays; the operand must itself be a repository root (resolve against cwd, no nearest-walk — §7); shared dots must be structurally equal or the command fails `patch collision: <author> revision <n>` with the local tree and `repository.json` untouched; the joined history validates (its replay is the canonical result); a clean working tree is required (`working tree is dirty` when it differs from the local replay's tree — checked after the joined replay, per §10's order, so a broken remote fails first); the delta installs and `repository.json` rewrites even when the merge is a no-op (equal/contained history → identical value, unobservable rewrite); stdout is the joined version, stderr lists only warnings the merge newly introduced. All failures funnel through the CLI boundary as `snap: <detail>`, exit 1.
- `snap merge <url>` differs only in operand resolution: one GET via `fetchRepository` (no redirects, full §4.5 validation), so a malformed or unreachable remote fails before any local mutation.
- `diff` and `revert` now accept any version reproducible from the stored history — including merged frontiers that name no single patch result. Previously only exact patch result versions (and `()`) were known; this was a latent bug the merge command surfaced, not a behavior change the spec requested.

## Tests

`cd ts && npm run check`: 423 tests / 88 suites green (from 396/83). New: `validate.test.ts` +3 (equal shared dots, byte-order collision pin, key-order-equal patches); `locate.test.ts` +2; `operand.test.ts` +5 (local `node:http` server for the URL arm); `union.test.ts` +6 (order, collapse, frontier join, collision-first); `merge.test.ts` +9 (fresh import, difference-only warnings, no-op byte pin, collision no-mutation, dirty, unsupported entry, malformed path and URL operands); `main.test.ts` dispatch reworked (+2/−2, all `run` calls await). `model.test.ts`: 4 knownness tests replaced 1:1 (merged-frontier known, empty+result known, dangling revision unknown, base-dot-dropped unknown). Lint forced braces on a void arrow in `validate.test.ts`; prettier reformatted three test files. The no-op test pins the stored bytes to `encodeRepository(decodeRepository(before))`: the fixture writes compact JSON, the merge rewrites canonical — same value, canonical form. Acceptance: `./verify --lang ts` 28/32 — 09, 10, 11, 17, 18, 20, 21, 22, 31 green (21 green for the first time, its merge-then-diff step 19 the knownness regression); 13, 16, 26 red only at their `diff --repo` steps (sibling strand `cross-repository-diff`); 28 red at step 1 (presentation strand, out of scope).

## Decisions

- Knownness is a property of the version against the history, not membership in an enumerated set: §1.1 invariant 4 defines a version as known when it is reproducible from the empty tree plus stored patches, and a merged frontier satisfies that even though no single patch produces it. The enumerated set was an implementation convenience that predated multi-parent frontiers.
- The `async function` form for `loadRepositoryOperand`: a sync function returning a promise still throws synchronously on the local arm's first failure; `async` moves every failure into the rejection path the caller already awaits.
- The no-op merge writes anyway (plan feedback #7): the rewrite is byte-identical in value and unobservable, so a skip-write branch buys nothing.
- The warning difference stays a consumer-side set difference over `path\0reason` (plan feedback #6): replay stays consumer-agnostic; the joined list is already §6.4-sorted, so the difference renders in canonical order.
- The cast-free merge-walk: the lint rules (`non-nullable-type-assertion-style`, no `!` outside tests) are repo-wide; restructuring the loop was cheaper and cleaner than an eslint-disable.
- Check order follows §10 and the `revert.ts` precedent (plan feedback #3): joined replay before working-tree scan — a broken remote reports before a dirty tree.

## Follow-Up

- When `cross-repository-diff` merges (immediately after this strand): run `./verify --lang ts --filter 13-http-client`, `--filter 16-dot-collision`, `--filter 26-portability-and-failure-safety` — all three go green with zero changes to this strand's code.
- tests/28 remains red at step 1 (presentation strand, out of scope here).
- The knownness rewrite lives in `repo/model.ts` on this strand; sibling strands rebasing after this one inherit `isKnownVersion` — nothing to port.
